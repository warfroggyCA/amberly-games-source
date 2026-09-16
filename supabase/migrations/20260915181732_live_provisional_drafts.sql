-- One replaceable, expiring preview per game. Never part of the journal, results or export.
-- Apply separately before deploying the live-preview API. Existing scores/history are untouched.
begin;
create table scrabble.live_drafts (
  family_id uuid not null,
  game_id text not null,
  scorer_user_id uuid not null,
  revision integer not null check (revision between 0 and 5000),
  generation integer not null check (generation > 0),
  stream_id uuid not null,
  sequence bigint not null check (sequence > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096),
  expires_at timestamptz not null,
  primary key (family_id, game_id),
  foreign key (family_id, game_id) references scrabble.game_heads(family_id, game_id),
  foreign key (family_id, scorer_user_id) references scrabble.memberships(family_id, user_id)
);
alter table scrabble.live_drafts enable row level security;
revoke all on scrabble.live_drafts from public, anon, authenticated, service_role;
grant select, insert, update on scrabble.live_drafts to scrabble_runtime;
create policy live_member_read on scrabble.live_drafts for select to scrabble_runtime
  using (scrabble.is_member(family_id));
create policy live_scorer_insert on scrabble.live_drafts for insert to scrabble_runtime
  with check (scrabble.is_member(family_id) and scorer_user_id=scrabble.actor_id() and exists (
    select 1 from scrabble.game_heads h where h.family_id=live_drafts.family_id and h.game_id=live_drafts.game_id
      and h.scorer_user_id=scrabble.actor_id() and h.revision=live_drafts.revision and h.scorer_generation=live_drafts.generation));
create policy live_scorer_update on scrabble.live_drafts for update to scrabble_runtime
  using (scrabble.is_member(family_id) and exists (
    select 1 from scrabble.game_heads h where h.family_id=live_drafts.family_id and h.game_id=live_drafts.game_id and h.scorer_user_id=scrabble.actor_id()))
  with check (scrabble.is_member(family_id) and scorer_user_id=scrabble.actor_id() and exists (
    select 1 from scrabble.game_heads h where h.family_id=live_drafts.family_id and h.game_id=live_drafts.game_id
      and h.scorer_user_id=scrabble.actor_id() and h.revision=live_drafts.revision and h.scorer_generation=live_drafts.generation));

create or replace function scrabble.read_watch(target_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',h.state->'id','revision',h.state->'revision','scorerGeneration',h.scorer_generation,'liveDraft',
      case when d.expires_at > now() and d.revision=h.revision
        and d.generation=h.scorer_generation and d.scorer_user_id=h.scorer_user_id
        and sm.active and h.state->>'status'='active' and h.state->'pendingEnd'='null'::jsonb
        then d.payload else null end,
    'players',h.state->'players','board',h.state->'board',
    'scores',h.state->'scores','turns',h.state->'turns','order',h.state->'order',
    'status',h.state->'status','pendingEnd',h.state->'pendingEnd',
    'currentPlayerId',h.state->'currentPlayerId',
    'expectedBagCount',h.state->'expectedBagCount',
    'tileSupply',h.state->'tileSupply',
    'assisted',coalesce(h.state->'assistance' <> 'null'::jsonb,false),
    'result',case when h.state->'result'='null'::jsonb then 'null'::jsonb else jsonb_build_object(
      'scores',h.state->'result'->'scores','winnerIds',h.state->'result'->'winnerIds',
      'reason',h.state->'result'->'reason','assisted',h.state->'result'->'assisted',
      'unequalTurns',h.state->'result'->'unequalTurns',
      'scoresBeforeAdjustments',h.state->'result'->'scoresBeforeAdjustments',
      'adjustments',h.state->'result'->'adjustments') end
  )
  from scrabble.watch_links w join scrabble.game_heads h using(family_id,game_id)
  join scrabble.memberships m on m.family_id=w.family_id and m.user_id=w.created_by
  left join scrabble.live_drafts d on d.family_id=h.family_id and d.game_id=h.game_id
  left join scrabble.memberships sm on sm.family_id=h.family_id and sm.user_id=h.scorer_user_id
  where target_hash ~ '^[a-f0-9]{64}$' and w.token_hash=target_hash and w.active
    and w.expires_at>now() and m.active
$$;

-- Lightweight polling avoids resending the full turn history for every letter.
create function scrabble.read_watch_draft(target_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('revision',h.revision,'generation',h.scorer_generation,'draft',
    case when d.expires_at>now() and d.revision=h.revision and d.generation=h.scorer_generation
      and d.scorer_user_id=h.scorer_user_id and sm.active
      and h.state->>'status'='active' and h.state->'pendingEnd'='null'::jsonb
      then d.payload else null end)
  from scrabble.watch_links w join scrabble.game_heads h using(family_id,game_id)
  join scrabble.memberships m on m.family_id=w.family_id and m.user_id=w.created_by
  left join scrabble.live_drafts d on d.family_id=h.family_id and d.game_id=h.game_id
  left join scrabble.memberships sm on sm.family_id=h.family_id and sm.user_id=h.scorer_user_id
  where target_hash ~ '^[a-f0-9]{64}$' and w.token_hash=target_hash and w.active
    and w.expires_at>now() and m.active
$$;
revoke all on function scrabble.read_watch_draft(text) from public, anon, authenticated, service_role;
grant execute on function scrabble.read_watch_draft(text) to scrabble_runtime;
commit;
