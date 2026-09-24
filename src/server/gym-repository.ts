import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { VerifiedActor } from "../lib/shared-contract";
import {
  gymId,
  isGymWrite,
  type GymWrite,
  type GymStoredEvent,
  type GymHistory,
  type GymIdentity,
  type GymSessionDetail,
} from "../lib/gym-history-contract";
import { SharedRepositoryError } from "./shared-repository";
import { requireCurrentSchema } from "./schema-compatibility";
import { verifyPuzzle } from "../domain/gym/generator";
import { validateAction, type Puzzle } from "../domain/gym/model";
import type { EnumerableLexicon } from "../domain/solver";
import { resolveLexicon } from "../lib/lexicons";
const fail = (code: string, message: string, status = 400): never => {
  throw new SharedRepositoryError(code, message, status);
};
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
      .join(",")}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export function gymFingerprint(p: Puzzle) {
  return hash({
    rules: p.rules,
    reference: p.reference,
    position: { ...p.position, rack: [...p.position.rack].sort() },
  });
}
export function createGymRepository(
  sql: postgres.Sql,
  options: {
    enabled?: boolean;
    lexicon?: (reference: unknown) => EnumerableLexicon;
  } = {},
) {
  async function transaction<T>(
    actor: VerifiedActor,
    familyId: string,
    write: boolean,
    work: (tx: postgres.TransactionSql, identity: GymIdentity) => Promise<T>,
  ): Promise<T> {
    if (!(
      options.enabled ?? process.env.AMBERLY_GYM_HISTORY_ENABLED === "true"
    ))
      fail("GYM_UNAVAILABLE", "Profile saving is not enabled yet.", 503);
    if (
      !gymId(actor.userId) ||
      !gymId(familyId) ||
      !actor.emailVerified ||
      typeof actor.email !== "string"
    )
      fail("INVALID_ACTOR", "Verified family access is required.", 403);
    return (await sql.begin(
      write ? "" : "isolation level repeatable read read only",
      async (tx) => {
        await tx`set local role scrabble_runtime`;
        await requireCurrentSchema(tx);
        await tx`select set_config('scrabble.actor_id',${actor.userId},true),set_config('scrabble.family_id',${familyId},true),set_config('scrabble.actor_email',${actor.email.toLowerCase()},true),set_config('scrabble.email_verified','true',true),set_config('statement_timeout','15000',true),set_config('lock_timeout','5000',true)`;
        // Membership relinks use the family lock too. Recheck linkage for every receipt/read.
        if (write)
          await tx`select id from scrabble.families where id=${familyId}::uuid for update`;
        const [member] =
          await tx`select player_id from scrabble.memberships where family_id=${familyId}::uuid and user_id=${actor.userId}::uuid and active`;
        if (!member?.player_id)
          fail(
            "NO_PROFILE",
            "Link your player profile before saving Gym practice.",
            403,
          );
        const [cap] =
          await tx`select to_regclass('scrabble.gym_sessions') is not null and to_regclass('scrabble.gym_events') is not null as ready`;
        if (!cap.ready)
          fail(
            "GYM_SCHEMA_REQUIRED",
            "Profile saving is not available on this server yet.",
            503,
          );
        return work(tx, {
          familyId,
          userId: actor.userId,
          playerId: member.player_id,
        });
      },
    )) as T;
  }
  async function read(
    actor: VerifiedActor,
    familyId: string,
    query: { sessionId?: string; cursor?: string } = {},
  ): Promise<GymHistory | GymSessionDetail> {
    if (query.sessionId && !gymId(query.sessionId))
      fail("INVALID_ID", "Invalid practice reference.");
    let cursor: { date: string; id: string } | null = null;
    if (query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
        if (
          !cursor ||
          !gymId(cursor.id) ||
          typeof cursor.date !== "string" ||
          cursor.date.length > 40 ||
          !Number.isFinite(Date.parse(cursor.date))
        )
          throw Error();
      } catch {
        fail("INVALID_CURSOR", "Invalid history page.");
      }
    }
    return transaction(actor, familyId, false, async (tx, identity) => {
      const player = identity.playerId;
      if (query.sessionId) {
        const [session] =
          await tx`select id,puzzle,replay from scrabble.gym_sessions where family_id=${familyId}::uuid and player_id=${player} and id=${query.sessionId}::uuid`;
        if (!session) fail("NOT_FOUND", "Practice session not found.", 404);
        const events =
          await tx`select event,received_at from scrabble.gym_events where family_id=${familyId}::uuid and player_id=${player} and session_id=${query.sessionId}::uuid order by sequence`;
        return {
          id: session.id,
          puzzle: session.puzzle,
          replay: session.replay,
          events: events.map((r) => ({
            ...r.event,
            receivedAt: r.received_at.toISOString(),
          })),
        };
      }
      const rows =
        await tx`select s.id,s.created_at,s.created_at::text cursor_date,s.replay,
       (select count(*)::integer from scrabble.gym_events e where e.family_id=s.family_id and e.player_id=s.player_id and e.session_id=s.id and e.event->'payload'->>'type'='attempt') attempts,
       (select e.event from scrabble.gym_events e where e.family_id=s.family_id and e.player_id=s.player_id and e.session_id=s.id and e.event->'payload'->>'type'='attempt' order by e.sequence limit 1) first
       from scrabble.gym_sessions s where s.family_id=${familyId}::uuid and s.player_id=${player}
       ${cursor ? tx`and (s.created_at,s.id)<(${cursor.date}::timestamptz,${cursor.id}::uuid)` : tx``}
       order by s.created_at desc,s.id desc limit 21`;
      const last = rows[19];
      return {
        identity,
        sessions: rows.slice(0, 20).map((r) => ({
          id: r.id,
          createdAt: r.created_at.toISOString(),
          replay: r.replay,
          attempts: r.attempts,
          firstPoints: r.first?.verifiedPoints ?? null,
          assisted: r.first?.assisted ?? true,
        })),
        nextCursor:
          rows.length > 20
            ? Buffer.from(
                JSON.stringify({ date: last.cursor_date, id: last.id }),
              ).toString("base64url")
            : null,
      };
    });
  }
  async function append(
    actor: VerifiedActor,
    familyId: string,
    input: unknown,
  ) {
    if (!isGymWrite(input) || JSON.stringify(input).length > 120000)
      fail("INVALID_EVENT", "Invalid practice event.");
    const data = input as GymWrite;
    // Authorize before validation work, then recheck inside the committing transaction.
    await transaction(actor, familyId, false, async (_tx, i) => {
      if (i.playerId !== data.playerId)
        fail(
          "PROFILE_CHANGED",
          "Your linked profile changed. Pending practice has been kept.",
          409,
        );
    });
    const lexicon = (options.lexicon ?? resolveLexicon)(data.puzzle.reference);
    try {
      verifyPuzzle(data.puzzle, lexicon);
    } catch {
      fail(
        "INVALID_PUZZLE",
        "The practice board or reference could not be verified.",
      );
    }
    let outcome: Partial<GymStoredEvent> = {};
    if (data.event.payload.type === "attempt") {
      try {
        outcome = {
          valid: true,
          verifiedPoints: validateAction(
            data.puzzle.position,
            data.event.payload.action,
            lexicon,
          ),
        };
      } catch (e) {
        outcome = {
          valid: false,
          verifiedPoints: null,
          reason: e instanceof Error ? e.message : "Invalid move",
        };
      }
    }
    const fingerprint = gymFingerprint(data.puzzle),
      payloadHash = hash(data);
    return transaction(actor, familyId, true, async (tx, identity) => {
      const player = identity.playerId;
      if (player !== data.playerId)
        fail(
          "PROFILE_CHANGED",
          "Your linked profile changed. Pending practice has been kept.",
          409,
        );
      const [existing] =
        await tx`select session_id,payload_hash from scrabble.gym_events where family_id=${familyId}::uuid and player_id=${player} and id=${data.event.id}::uuid`;
      if (existing) {
        if (
          existing.payload_hash !== payloadHash ||
          existing.session_id !== data.sessionId
        )
          fail(
            "EVENT_CONFLICT",
            "This event identifier was already used for different practice data.",
            409,
          );
        return {
          eventId: data.event.id,
          sessionId: data.sessionId,
          sequence: data.event.sequence,
        };
      }
      let [session] =
        await tx`select * from scrabble.gym_sessions where family_id=${familyId}::uuid and player_id=${player} and id=${data.sessionId}::uuid`;
      if (!session) {
        if (data.event.sequence !== 1)
          fail(
            "SEQUENCE_CONFLICT",
            "Earlier practice events must sync first.",
            409,
          );
        const [seen] =
          await tx`select id from scrabble.gym_sessions where family_id=${familyId}::uuid and player_id=${player} and fingerprint=${fingerprint} limit 1`;
        [session] =
          await tx`insert into scrabble.gym_sessions(family_id,player_id,id,actor_id,fingerprint,puzzle,replay) values(${familyId}::uuid,${player},${data.sessionId}::uuid,${actor.userId}::uuid,${fingerprint},${tx.json(JSON.parse(JSON.stringify(data.puzzle)))},${!!seen}) returning *`;
      } else if (
        session.actor_id !== actor.userId ||
        hash(session.puzzle) !== hash(data.puzzle)
      )
        fail(
          "SESSION_CONFLICT",
          "The saved practice session cannot be replaced.",
          409,
        );
      const previous =
        await tx`select event from scrabble.gym_events where family_id=${familyId}::uuid and player_id=${player} and session_id=${data.sessionId}::uuid order by sequence`;
      if (data.event.sequence !== previous.length + 1)
        fail(
          "SEQUENCE_CONFLICT",
          "Practice events arrived out of order. Retry pending saves.",
          409,
        );
      const payload = data.event.payload;
      if (payload.type === "score" || payload.type === "strategy") {
        const target = previous.find((r) => r.event.id === payload.attemptId)
          ?.event as GymStoredEvent | undefined;
        if (!target || target.payload.type !== "attempt" || !target.valid)
          fail(
            "INVALID_ASSESSMENT",
            "The original valid attempt must be saved first.",
          );
        if (
          payload.type === "score" &&
          payload.points !== target!.verifiedPoints
        )
          fail(
            "INVALID_SCORE",
            "The reported points differ from the verified move.",
          );
      }
      const assisted =
        session.replay ||
        previous.some((r) =>
          ["hint", "solve", "live-coaching", "strategy-request"].includes(
            r.event.payload.type,
          ),
        );
      const stored: Omit<GymStoredEvent, "receivedAt"> = {
        ...data.event,
        ...outcome,
        assisted,
        firstAttempt:
          payload.type === "attempt" &&
          !previous.some((r) => r.event.payload.type === "attempt"),
      };
      await tx`insert into scrabble.gym_events(family_id,player_id,session_id,id,sequence,payload_hash,event) values(${familyId}::uuid,${player},${data.sessionId}::uuid,${data.event.id}::uuid,${data.event.sequence},${payloadHash},${tx.json(JSON.parse(JSON.stringify(stored)))})`;
      return {
        eventId: data.event.id,
        sessionId: data.sessionId,
        sequence: data.event.sequence,
      };
    });
  }
  return { read, append };
}
