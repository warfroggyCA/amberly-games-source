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
          await tx`select set_config('scrabble.actor_id',${actor.userId},true),set_config('scrabble.family_id',${familyId},true),set_config('statement_timeout','15000',true)`;
          const [member] =
            await tx`select user_id from scrabble.memberships where family_id=${familyId}::uuid and user_id=${actor.userId}::uuid and active`;
          if (!member)
            throw new SharedRepositoryError(
              "NOT_A_MEMBER",
              "This account does not have active family access.",
              403,
            );
          // Execute under the restricted role: each source's RLS applies before the union.
          const rows = await tx`
          with games as (
            select 'scrabble'::text game_type,d.game_id,d.created_at,h.state->>'status' status,
              h.state->'players' participants,h.state->'scores' totals,coalesce(h.state->'result'->'winnerIds','[]'::jsonb) winner_ids,
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
