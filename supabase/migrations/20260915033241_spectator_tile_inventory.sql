-- Add only public tile totals to the existing bounded private-link projection.
-- Replacing the function preserves its owner/grants and all existing link checks.
-- No rack contents, journal events, account data, or stored games are changed.
create or replace function scrabble.read_watch(target_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',h.state->'id','players',h.state->'players','board',h.state->'board',
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
  where target_hash ~ '^[a-f0-9]{64}$' and w.token_hash=target_hash and w.active
    and w.expires_at>now() and m.active
$$;
