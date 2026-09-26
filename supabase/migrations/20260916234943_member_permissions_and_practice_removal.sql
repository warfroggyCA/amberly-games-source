-- Additive, defaults preserve existing accounts. Apply before deploying the new API.
begin;
create function scrabble.valid_member_permissions(value jsonb) returns boolean
language sql immutable set search_path = '' as $$
 select case when jsonb_typeof(value) <> 'object' then false else not exists(
   select 1 from jsonb_each(value) e where not (e.key = any(array['startGames','scoreGames','addPlayers','editOwnProfile','manageEquipment','shareGames','editAllProfiles','takeOverScoring','resolveConcerns','inviteMembers','exportHistory'])) or jsonb_typeof(e.value) <> 'boolean'
 ) end
$$;
alter table scrabble.memberships add column permissions jsonb not null default '{}'::jsonb
 check(scrabble.valid_member_permissions(permissions));
-- Invoker rights: the existing membership policy controls this read, with no new bypass.
create function scrabble.has_permission(target uuid, permission text) returns boolean
language sql stable set search_path = '' as $$
 select exists(select 1 from scrabble.memberships m where m.family_id=target
   and m.user_id=scrabble.actor_id() and m.active and permission=any(array['startGames','scoreGames','addPlayers','editOwnProfile','manageEquipment','shareGames','editAllProfiles','takeOverScoring','resolveConcerns','inviteMembers','exportHistory'])
   and (m.role='superadmin' or coalesce((m.permissions->>permission)::boolean, permission=any(array['startGames','scoreGames','addPlayers','editOwnProfile','manageEquipment','shareGames']))))
$$;
revoke all on function scrabble.valid_member_permissions(jsonb),scrabble.has_permission(uuid,text) from public,anon,authenticated,service_role;
grant execute on function scrabble.valid_member_permissions(jsonb),scrabble.has_permission(uuid,text) to scrabble_runtime;

alter policy player_insert on scrabble.players with check(scrabble.has_permission(family_id,'addPlayers'));
alter policy player_update on scrabble.players
 using(scrabble.has_permission(family_id,'editAllProfiles') or (scrabble.owns_player(family_id,id) and scrabble.has_permission(family_id,'editOwnProfile')))
 with check(scrabble.has_permission(family_id,'editAllProfiles') or (scrabble.owns_player(family_id,id) and scrabble.has_permission(family_id,'editOwnProfile')));
alter policy invite_insert on scrabble.invitations with check(scrabble.has_permission(family_id,'inviteMembers'));
alter policy invite_update on scrabble.invitations using(scrabble.has_permission(family_id,'inviteMembers')) with check(scrabble.has_permission(family_id,'inviteMembers'));
alter policy admin_resolution on scrabble.game_protest_resolutions with check(scrabble.has_permission(family_id,'resolveConcerns') and resolver_id=scrabble.actor_id());
alter policy member_insert on scrabble.equipment with check(scrabble.has_permission(family_id,'manageEquipment') and updated_by=scrabble.actor_id());
alter policy member_update on scrabble.equipment using(scrabble.has_permission(family_id,'manageEquipment')) with check(scrabble.has_permission(family_id,'manageEquipment') and updated_by=scrabble.actor_id());

-- A removal marker hides a practice game while leaving original evidence untouched.
create table scrabble.game_removals (
 family_id uuid not null,
 game_id text not null,
 actor_id uuid not null,
 game_revision integer not null check(game_revision >= 0),
 reason text not null check(char_length(reason) between 1 and 500),
 removed_at timestamptz not null default now(),
 primary key(family_id,game_id),
 foreign key(family_id,game_id) references scrabble.game_definitions(family_id,game_id),
 foreign key(family_id,actor_id) references scrabble.memberships(family_id,user_id)
);
alter table scrabble.game_removals enable row level security;
revoke all on scrabble.game_removals from public,anon,authenticated,service_role;
grant select,insert on scrabble.game_removals to scrabble_runtime;
create policy member_read on scrabble.game_removals for select to scrabble_runtime using(scrabble.is_member(family_id));
create policy admin_remove on scrabble.game_removals for insert to scrabble_runtime with check(
 scrabble.is_member(family_id,true) and actor_id=scrabble.actor_id() and exists(
  select 1 from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id)
  where d.family_id=game_removals.family_id and d.game_id=game_removals.game_id and d.mode='practice' and h.revision=game_removals.game_revision));
create trigger no_erasure before delete or truncate on scrabble.game_removals for each statement execute function scrabble.prevent_erasure();
create trigger immutable_update before update on scrabble.game_removals for each statement execute function scrabble.prevent_erasure();
alter policy member_insert on scrabble.game_definitions with check(scrabble.has_permission(family_id,'startGames') and scrabble.has_permission(family_id,'scoreGames') and created_by=scrabble.actor_id() and (mode='confirmed' or scrabble.is_member(family_id,true)));
-- Practice is an admin-only development workspace, including legacy practice games.
alter policy member_read on scrabble.game_definitions using(scrabble.is_member(family_id) and (mode='confirmed' or scrabble.is_member(family_id,true)));
alter policy member_read on scrabble.game_heads using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_heads.family_id and d.game_id=game_heads.game_id));
alter policy member_read on scrabble.game_events using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_events.family_id and d.game_id=game_events.game_id));
alter policy member_read on scrabble.game_results using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_results.family_id and d.game_id=game_results.game_id));
alter policy member_read on scrabble.game_participants using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_participants.family_id and d.game_id=game_participants.game_id));
alter policy member_read on scrabble.game_approvals using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_approvals.family_id and d.game_id=game_approvals.game_id));
alter policy member_read on scrabble.watch_links using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=watch_links.family_id and d.game_id=watch_links.game_id));
alter policy family_read on scrabble.game_protests using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_protests.family_id and d.game_id=game_protests.game_id));
alter policy family_read on scrabble.game_protest_resolutions using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_protest_resolutions.family_id and d.game_id=game_protest_resolutions.game_id));
alter policy live_member_read on scrabble.live_drafts using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=live_drafts.family_id and d.game_id=live_drafts.game_id));
alter policy member_read on scrabble.game_removals using(scrabble.is_member(family_id) and exists(select 1 from scrabble.game_definitions d where d.family_id=game_removals.family_id and d.game_id=game_removals.game_id));
alter policy member_read on scrabble.audit using(scrabble.is_member(family_id,true));
alter policy member_read on scrabble.requests using(scrabble.is_member(family_id) and actor_id=scrabble.actor_id());
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

-- Lightweight polling avoids resending the full turn history for every letter.
create or replace function scrabble.read_watch_draft(target_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('revision',h.revision,'generation',h.scorer_generation,'draft',
    case when d.expires_at>now() and d.revision=h.revision and d.generation=h.scorer_generation
      and d.scorer_user_id=h.scorer_user_id and sm.active and (sm.role='superadmin' or coalesce((sm.permissions->>'scoreGames')::boolean,true))
      and h.state->>'status'='active' and h.state->'pendingEnd'='null'::jsonb
      then d.payload else null end)
  from scrabble.watch_links w join scrabble.game_heads h using(family_id,game_id) join scrabble.game_definitions g using(family_id,game_id)
  join scrabble.memberships m on m.family_id=w.family_id and m.user_id=w.created_by
  left join scrabble.live_drafts d on d.family_id=h.family_id and d.game_id=h.game_id
  left join scrabble.memberships sm on sm.family_id=h.family_id and sm.user_id=h.scorer_user_id
  where g.mode='confirmed' and target_hash ~ '^[a-f0-9]{64}$' and w.token_hash=target_hash and w.active
    and w.expires_at>now() and m.active and not exists(select 1 from scrabble.game_removals r where r.family_id=h.family_id and r.game_id=h.game_id)
$$;
commit;
