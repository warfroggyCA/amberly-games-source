import { SharedRepositoryError } from "./shared-repository";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import { setImmediate } from "node:timers/promises";
import {
  hydrateGame,
  hydrateGameCooperatively,
  type GameResult,
  type GameState,
} from "../domain/game";
import { deriveLeadCounts } from "../domain/lead-counts";
import { competitiveResultEligible } from "../domain/records";
import {
  aggregateLeadStandings,
  type LeadAssessment,
} from "../lib/lead-standings";
import { resolveLexicon } from "../lib/lexicons";

export const MAX_LEAD_GAMES = 5000;
function capacityError() {
  return new SharedRepositoryError(
    "LEAD_CAPACITY",
    "Lead rankings currently support up to 5,000 completed games. No totals were loaded.",
    422,
  );
}
type LeadHead = {
  game_id: string;
  revision: number;
  definition: GameState["definition"];
  state: GameState;
  disputed: boolean;
};
/** Cache only small verified summaries. Authorization and exact canonical bytes are checked on every read. */
export function createLeadAssessor() {
  const families = new Map<
    string,
    Map<string, { key: string; value: LeadAssessment }>
  >();
  function assess(
    familyId: string,
    head: LeadHead,
    events: unknown[],
    cachedOnly?: false,
  ): LeadAssessment;
  function assess(
    familyId: string,
    head: LeadHead,
    events: unknown[],
    cachedOnly: true,
  ): LeadAssessment | null;
  function assess(
    familyId: string,
    head: LeadHead,
    events: unknown[],
    cachedOnly = false,
  ): LeadAssessment | null {
    const steps = evaluate(familyId, head, events, cachedOnly);
    const step = steps.next();
    if (step.done) return step.value;
    return steps.next(hydrateGame(step.value.raw, step.value.lexicon))
      .value as LeadAssessment;
  }
  function* evaluate(
    familyId: string,
    head: LeadHead,
    events: unknown[],
    cachedOnly: boolean,
  ): Generator<
    { raw: GameState; lexicon: ReturnType<typeof resolveLexicon> },
    LeadAssessment | null,
    GameResult
  > {
    const cache =
      families.get(familyId) ??
      new Map<string, { key: string; value: LeadAssessment }>();
    families.delete(familyId);
    families.set(familyId, cache);
    if (families.size > 4) families.delete(families.keys().next().value!);
    if (!cache.has(head.game_id) && cache.size >= MAX_LEAD_GAMES)
      throw capacityError();
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
      const cached = cache.get(head.game_id);
      if (cached?.key === key) return structuredClone(cached.value);
      cache.delete(head.game_id);
      if (cachedOnly) return null;
      let lexicon;
      try {
        lexicon = resolveLexicon(raw.lexicon);
      } catch {
        // Supported dictionaries are bundled and immutable for this process.
        // Deploying another version recreates this process-local cache.
        cache.set(head.game_id, { key, value: structuredClone(assessment) });
        return assessment;
      }
      const restored = yield { raw, lexicon };
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
        }
      }
      // Deterministic invalid journals must not consume the same cold budget forever.
      cache.set(head.game_id, { key, value: structuredClone(assessment) });
    } catch {
      /* Unavailable exact word versions/malformed journals are coverage gaps. */
    }
    return assessment;
  }
  return Object.assign(assess, {
    async cooperatively(
      familyId: string,
      head: LeadHead,
      events: unknown[],
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted();
      const steps = evaluate(familyId, head, events, false);
      const step = steps.next();
      if (step.done) return step.value!;
      const restored = await hydrateGameCooperatively(
        step.value.raw,
        step.value.lexicon,
        async () => {
          signal?.throwIfAborted();
          await setImmediate(undefined, { signal });
          signal?.throwIfAborted();
        },
      );
      return steps.next(restored).value as LeadAssessment;
    },
    retain(familyId: string, ids: ReadonlySet<string>) {
      const cache = families.get(familyId);
      if (cache)
        for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
    },
  });
}
const assess = createLeadAssessor();

/** Keep progress within a family snapshot; only whole least-recently-used family caches are evicted. */
export function createLeadCollection(
  familyId: string,
  assessor = assess,
  now = () => performance.now(),
) {
  const assessments: LeadAssessment[] = [];
  const pending: LeadHead[] = [];
  const seen = new Set<string>();
  return {
    add(head: LeadHead, events: unknown[]) {
      seen.add(head.game_id);
      if (seen.size > MAX_LEAD_GAMES) throw capacityError();
      const result = assessor(familyId, head, events, true);
      if (result) assessments.push(result);
      else pending.push(head); // Exact permanent events already matched this immutable snapshot.
    },
    async finishCooperatively(signal?: AbortSignal) {
      assessor.retain(familyId, seen);
      const deadline = now() + 1000;
      for (const head of pending) {
        signal?.throwIfAborted();
        if (now() >= deadline)
          assessments.push({
            gameId: head.game_id,
            revision: head.revision,
            playerIds: head.definition.players.map((p) => p.id),
            outcome: "pending",
          });
        else
          assessments.push(
            await assessor.cooperatively(
              familyId,
              head,
              head.state.events,
              signal,
            ),
          );
      }
      signal?.throwIfAborted();
      return aggregateLeadStandings(assessments);
    },
    finish() {
      assessor.retain(familyId, seen);
      const deadline = now() + 1000;
      for (const head of pending) {
        if (now() >= deadline)
          assessments.push({
            gameId: head.game_id,
            revision: head.revision,
            playerIds: head.definition.players.map((p) => p.id),
            outcome: "pending",
          });
        else assessments.push(assessor(familyId, head, head.state.events));
      }
      return aggregateLeadStandings(assessments);
    },
  };
}

/** Caller owns an authorized, RLS-restricted repeatable-read transaction. */
export async function readLeadStandings(
  tx: postgres.TransactionSql,
  familyId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const heads = await tx`
    select d.game_id,d.definition,h.state,h.revision,
      exists(select 1 from scrabble.game_protests p left join scrabble.game_protest_resolutions r
        on r.family_id=p.family_id and r.game_id=p.game_id and r.protest_id=p.id
        where p.family_id=d.family_id and p.game_id=d.game_id and (r.outcome is null or r.outcome='upheld')) disputed
    from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id)
    where d.family_id=${familyId}::uuid and d.mode='confirmed'
      and h.state->>'status'='finalized' and h.state->>'mode'='multiplayer'
      and not exists(select 1 from scrabble.game_removals r where r.family_id=d.family_id and r.game_id=d.game_id)
    order by d.game_id limit 5001`;
  if (heads.length > MAX_LEAD_GAMES) throw capacityError();
  assess.retain(familyId, new Set(heads.map((h) => h.game_id)));
  const collection = createLeadCollection(familyId);
  // Bounded batches avoid a query per game and never retain a second full-family journal.
  for (let start = 0; start < heads.length; start += 25) {
    signal?.throwIfAborted();
    await setImmediate(undefined, { signal });
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
    for (const head of batch) {
      // Warm reads still hash canonical bytes; let disconnects/other requests run
      // between games instead of monopolizing a whole 25-journal batch.
      await setImmediate(undefined, { signal });
      collection.add(head as LeadHead, journals.get(head.game_id) ?? []);
    }
  }
  return collection.finishCooperatively(signal);
}
