import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import { hydrateGame, type GameState } from "../domain/game";
import { deriveLeadCounts } from "../domain/lead-counts";
import { competitiveResultEligible } from "../domain/records";
import {
  aggregateLeadStandings,
  type LeadAssessment,
} from "../lib/lead-standings";
import { resolveLexicon } from "../lib/lexicons";

type LeadHead = {
  game_id: string;
  revision: number;
  definition: GameState["definition"];
  state: GameState;
  disputed: boolean;
};
/** Cache only small verified summaries. Authorization and exact canonical bytes are checked on every read. */
export function createLeadAssessor() {
  const cache = new Map<string, LeadAssessment>();
  return (
    familyId: string,
    head: LeadHead,
    events: unknown[],
  ): LeadAssessment => {
    const assessment: LeadAssessment = {
      gameId: head.game_id,
      revision: head.revision,
      playerIds: Array.isArray(head.definition?.players)
        ? head.definition.players
            .filter((p) => p && typeof p.id === "string")
            .map((p) => p.id)
        : [],
      outcome: "unavailable",
    };
    try {
      const raw = head.state;
      if (head.disputed || !competitiveResultEligible(raw))
        return { ...assessment, outcome: "excluded" };
      if (
        head.game_id !== raw.id ||
        head.revision !== raw.revision ||
        !isDeepStrictEqual(raw.definition, head.definition) ||
        !isDeepStrictEqual(raw.events, events)
      )
        return assessment;
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            familyId,
            head.game_id,
            head.revision,
            head.definition,
            raw,
            events,
          ]),
        )
        .digest("hex");
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return structuredClone(cached);
      }
      const restored = hydrateGame(raw, resolveLexicon(raw.lexicon));
      if (restored.ok) {
        const counts = deriveLeadCounts(restored.game);
        if (counts.available) {
          assessment.outcome = "eligible";
          // Aggregation needs lengths and totals, not each game's full spell list.
          assessment.counts = {
            ...counts,
            players: counts.players.map((p) => ({ ...p, spells: [] })),
          };
          assessment.playerIds = restored.game.order;
          cache.set(key, structuredClone(assessment));
          if (cache.size > 64) cache.delete(cache.keys().next().value!);
        }
      }
    } catch {
      /* Unavailable exact word versions/malformed journals are coverage gaps. */
    }
    return assessment;
  };
}
const assess = createLeadAssessor();

/** Caller owns an authorized, RLS-restricted repeatable-read transaction. */
export async function readLeadStandings(
  tx: postgres.TransactionSql,
  familyId: string,
) {
  const heads = await tx`
    select d.game_id,d.definition,h.state,h.revision,
      exists(select 1 from scrabble.game_protests p left join scrabble.game_protest_resolutions r
        on r.family_id=p.family_id and r.game_id=p.game_id and r.protest_id=p.id
        where p.family_id=d.family_id and p.game_id=d.game_id and (r.outcome is null or r.outcome='upheld')) disputed
    from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id)
    where d.family_id=${familyId}::uuid and d.mode='confirmed'
      and h.state->>'status'='finalized' and h.state->>'mode'='multiplayer'
      and not exists(select 1 from scrabble.game_removals r where r.family_id=d.family_id and r.game_id=d.game_id)
    order by d.game_id`;
  const assessments: LeadAssessment[] = [];
  // Bounded batches avoid a query per game and never retain a second full-family journal.
  for (let start = 0; start < heads.length; start += 25) {
    const batch = heads.slice(start, start + 25);
    const events = await tx`select game_id,event from scrabble.game_events
      where family_id=${familyId}::uuid and game_id in ${tx(batch.map((h) => h.game_id))}
      order by game_id,sequence`;
    const journals = new Map<string, unknown[]>();
    for (const event of events) {
      const journal = journals.get(event.game_id) ?? [];
      journal.push(event.event);
      journals.set(event.game_id, journal);
    }
    for (const head of batch)
      assessments.push(
        assess(familyId, head as LeadHead, journals.get(head.game_id) ?? []),
      );
  }
  return aggregateLeadStandings(assessments);
}
