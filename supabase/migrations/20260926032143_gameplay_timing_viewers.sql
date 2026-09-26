-- Add only public timing facts and tile counts; retain all existing watch-link authorization.
begin;
create or replace function scrabble.read_watch(target_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',h.state->'id','revision',h.state->'revision','scorerGeneration',h.scorer_generation,'liveDraft',
      case when d.expires_at > now() and d.revision=h.revision
        and d.generation=h.scorer_generation and d.scorer_user_id=h.scorer_user_id
        and sm.active and (sm.role='superadmin' or coalesce((sm.permissions->>'scoreGames')::boolean,true)) and h.state->>'status'='active' and h.state->'pendingEnd'='null'::jsonb
        then d.payload else null end,
    'players',h.state->'players','board',h.state->'board',
    'scores',h.state->'scores','turns',h.state->'turns','order',h.state->'order',
    'status',h.state->'status','pendingEnd',h.state->'pendingEnd',
    'currentPlayerId',h.state->'currentPlayerId',
    'expectedBagCount',h.state->'expectedBagCount',
    'expectedRackCounts',h.state->'expectedRackCounts',
    'timingEvents',(select coalesce(jsonb_agg(jsonb_build_object(
      'type',e->'command'->>'type','timedAt',e->'command'->'timedAt','turnId',e->'turn'->'id'
    ) order by n),'[]'::jsonb) from jsonb_array_elements(h.state->'events') with ordinality as history(e,n)
      where e->'command'->>'type' in ('start-clock','play','pass','exchange','assisted-pass','pause','resume','undo','finalize')),
    'tileSupply',h.state->'tileSupply',
    'assisted',coalesce(h.state->'assistance' <> 'null'::jsonb,false),
    'result',case when h.state->'result'='null'::jsonb then 'null'::jsonb else jsonb_build_object(
      'scores',h.state->'result'->'scores','winnerIds',h.state->'result'->'winnerIds',
      'reason',h.state->'result'->'reason','assisted',h.state->'result'->'assisted',
      'unequalTurns',h.state->'result'->'unequalTurns',
      'scoresBeforeAdjustments',h.state->'result'->'scoresBeforeAdjustments',
      'adjustments',h.state->'result'->'adjustments') end
  )
  from scrabble.watch_links w join scrabble.game_heads h using(family_id,game_id) join scrabble.game_definitions g using(family_id,game_id)
  join scrabble.memberships m on m.family_id=w.family_id and m.user_id=w.created_by
  left join scrabble.live_drafts d on d.family_id=h.family_id and d.game_id=h.game_id
  left join scrabble.memberships sm on sm.family_id=h.family_id and sm.user_id=h.scorer_user_id
  where g.mode='confirmed' and target_hash ~ '^[a-f0-9]{64}$' and w.token_hash=target_hash and w.active
    and w.expires_at>now() and m.active and not exists(select 1 from scrabble.game_removals r where r.family_id=h.family_id and r.game_id=h.game_id)
$$;
commit;
