import type { Standing } from "../lib/standings";
import { checkedCrokinoleState } from "./crokinole-integrity";
import { requireCurrentSchema } from "./schema-compatibility";
import { createCrokinoleRepository } from "./crokinole-repository";
import type postgres from "postgres";
import type { VerifiedActor } from "../lib/shared-contract";
import type { GameSummaryPage, GameSummary } from "../lib/game-summary";
import {
  createSharedRepository,
  SharedRepositoryError,
} from "./shared-repository";

export function createGameSummaryRepository(sql: postgres.Sql) {
  return {
    async exportHistory(actor: VerifiedActor, familyId: string) {
      const scrabble = await createSharedRepository(sql).exportHistory(
        actor,
        familyId,
      );
      const crokinole = await createCrokinoleRepository(sql).exportHistory(
        actor,
        familyId,
      );
      return {
        format: "amberly-games-archive-v2",
        version: 2,
        familyId,
        exportedAt: new Date().toISOString(),
        scrabble,
        crokinole,
      };
    },
    async read(
      actor: VerifiedActor,
      familyId: string,
      query: { cursor?: string; gameType?: string; playerId?: string } = {},
    ): Promise<GameSummaryPage> {
      const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
      if (
        !uuid.test(actor.userId) ||
        !uuid.test(familyId) ||
        actor.emailVerified !== true
      )
        throw new SharedRepositoryError(
          "FORBIDDEN",
          "Family sign-in is required.",
          403,
        );
      if (query.gameType && !["scrabble", "crokinole"].includes(query.gameType))
        throw new SharedRepositoryError(
          "INVALID_FILTER",
          "Choose a supported game.",
          400,
        );
      if (
        query.playerId &&
        !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(query.playerId)
      )
        throw new SharedRepositoryError(
          "INVALID_FILTER",
          "Choose a player.",
          400,
        );
      let cursor: { date: string; type: string; id: string } | null = null;
      if (query.cursor) {
        try {
          cursor = JSON.parse(
            Buffer.from(query.cursor, "base64url").toString("utf8"),
          );
          if (
            !cursor ||
            typeof cursor.date !== "string" ||
            cursor.date.length > 80 ||
            !Number.isFinite(Date.parse(cursor.date)) ||
            !["scrabble", "crokinole"].includes(cursor.type) ||
            typeof cursor.id !== "string" ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(cursor.id)
          )
            throw new Error();
        } catch {
          throw new SharedRepositoryError(
            "INVALID_CURSOR",
            "The history page is invalid.",
            400,
          );
        }
      }
      return (await sql.begin(
        "isolation level repeatable read read only",
        async (tx) => {
          await tx`set local role scrabble_runtime`;
          await requireCurrentSchema(tx);
          await tx`select set_config('scrabble.actor_id',${actor.userId},true),set_config('scrabble.family_id',${familyId},true),set_config('statement_timeout','15000',true)`;
          const [member] =
            await tx`select user_id from scrabble.memberships where family_id=${familyId}::uuid and user_id=${actor.userId}::uuid and active`;
          if (!member)
            throw new SharedRepositoryError(
              "NOT_A_MEMBER",
              "This account does not have active family access.",
              403,
            );
          // Full-history aggregate in the same RLS-protected snapshot; never page-based totals.
          const standingsRows = !query.cursor
            ? await tx`
            with eligible as (
              select 'scrabble'::text game_type, h.state->'players' participants, h.state->'result'->'winnerIds' winners
              from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id)
              where d.family_id=${familyId}::uuid and d.mode='confirmed'
                and h.state->>'status'='finalized' and h.state->>'mode'='multiplayer'
                and h.state->'lexicon'->>'status'='ready'
                and h.state->'result'->>'reason' in ('natural','blocked')
                and h.state->'result'->>'assisted'='false'
                and (h.state->'assistance' is null or h.state->'assistance'='null'::jsonb)
                and not (h.state ? 'tileSupply')
                and jsonb_array_length(coalesce(h.state->'verifiedWords','[]'::jsonb))=0
                and not exists(select 1 from jsonb_array_elements(h.state->'events') e where e->'command'->>'type' in ('extend-supply','verify-words'))
                and not exists(select 1 from scrabble.game_removals r where r.family_id=d.family_id and r.game_id=d.game_id)
                and not exists(select 1 from scrabble.game_protests p left join scrabble.game_protest_resolutions r on r.family_id=p.family_id and r.game_id=p.game_id and r.protest_id=p.id where p.family_id=d.family_id and p.game_id=d.game_id and (r.outcome is null or r.outcome='upheld'))
              union all
              select 'crokinole',definition->'participants',state->'result'->'winnerIds'
              from scrabble.crokinole_games g where family_id=${familyId}::uuid and mode='confirmed' and not removed and state->>'status'='completed'
                and not exists(select 1 from scrabble.crokinole_concerns c where c.family_id=g.family_id and c.game_id=g.game_id and coalesce(c.concern->'resolution'->>'outcome','open')<>'dismissed')
            ), participants as (
              select game_type,p->>'id' side_id,coalesce(p->'playerIds',jsonb_build_array(p->>'id')) player_ids,winners from eligible cross join lateral jsonb_array_elements(participants) p
            ) select game_type,player_id,count(*)::int played,
              count(*) filter(where winners ? side_id and jsonb_array_length(winners)=1)::int wins,
              count(*) filter(where winners ? side_id and jsonb_array_length(winners)>1)::int ties
              from participants cross join lateral jsonb_array_elements_text(player_ids) player_id
              group by game_type,player_id order by game_type,player_id
          `
            : null;
          const standings: Standing[] | undefined = standingsRows?.map((r) => ({
            gameType: r.game_type,
            playerId: r.player_id,
            played: r.played,
            wins: r.wins,
            ties: r.ties,
          }));
          // Execute under the restricted role: each source's RLS applies before the union.
          const rows = await tx`
          with games as (
            select 'scrabble'::text game_type,d.game_id,d.created_at,h.state->>'status' status,
              h.state->'players' participants,
              case when h.state->>'status'='finalized' then h.state->'result'->'scores' else h.state->'scores' end totals,
              coalesce(h.state->'result'->'winnerIds','[]'::jsonb) winner_ids,
              d.mode,h.scorer_user_id,h.revision
            from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id)
            where d.family_id=${familyId}::uuid and not exists(select 1 from scrabble.game_removals r where r.family_id=d.family_id and r.game_id=d.game_id)
            union all
            select 'crokinole',game_id,created_at,state->>'status',definition->'participants',state->'totals',
              coalesce(state->'result'->'winnerIds','[]'::jsonb),mode,scorer_user_id,revision
            from scrabble.crokinole_games where family_id=${familyId}::uuid and not removed
          ) select *,created_at::text cursor_date from games
          where true
          ${query.gameType ? tx`and game_type=${query.gameType}` : tx``}
          ${query.playerId ? tx`and exists(select 1 from jsonb_array_elements(participants) p where p->>'id'=${query.playerId} or p->'playerIds' ? ${query.playerId})` : tx``}
          ${cursor ? tx`and (created_at,game_type,game_id)<(${cursor.date}::text::timestamptz,${cursor.type},${cursor.id})` : tx``}
          order by created_at desc,game_type desc,game_id desc limit 31`;
          // Verify each returned Crokinole projection in this same snapshot.
          // Two batched reads avoid a query per game and detect same-revision edits.
          const ids = rows
            .slice(0, 30)
            .filter((r) => r.game_type === "crokinole")
            .map((r) => r.game_id);
          if (ids.length) {
            const heads =
              await tx`select game_id,definition,state,revision from scrabble.crokinole_games where family_id=${familyId}::uuid and game_id in ${tx(ids)}`;
            const events =
              await tx`select game_id,event from scrabble.crokinole_events where family_id=${familyId}::uuid and game_id in ${tx(ids)} order by game_id,sequence`;
            const journals = new Map<string, unknown[]>();
            for (const row of events) {
              const journal = journals.get(row.game_id) ?? [];
              journal.push(row.event);
              journals.set(row.game_id, journal);
            }
            for (const head of heads)
              checkedCrokinoleState(
                head.definition,
                journals.get(head.game_id) ?? [],
                head.state,
                head.revision,
              );
          }
          const games: GameSummary[] = rows.slice(0, 30).map((row) => ({
            gameType: row.game_type,
            id: row.game_id,
            createdAt: new Date(row.created_at).toISOString(),
            status: row.status,
            participants: row.participants,
            totals: row.totals,
            winnerIds: row.winner_ids,
            mode: row.mode,
            scorerUserId: row.scorer_user_id,
            revision: row.revision,
          }));
          const last = rows[29];
          return {
            games,
            ...(standings ? { standings } : {}),
            nextCursor:
              rows.length > 30
                ? Buffer.from(
                    JSON.stringify({
                      date: last.cursor_date,
                      type: last.game_type,
                      id: last.game_id,
                    }),
                  ).toString("base64url")
                : null,
          };
        },
      )) as GameSummaryPage;
    },
  };
}
