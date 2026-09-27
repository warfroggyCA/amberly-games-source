-- Optional, additive access reporting. No existing game/history rows are changed.
begin;
create table scrabble.usage_pulses (
 family_id uuid not null,
 actor_id uuid not null,
 id uuid not null,
 visit_id uuid not null,
 area text not null check (area in ('games','scrabble','crokinole','gym','history','players','settings','administration')),
 screen text not null check (screen in ('games','scrabble','crokinole','gym','history','players','settings','administration')),
 is_view boolean not null,
 active_ms integer not null check (active_ms between 0 and 15000),
 received_at timestamptz not null default clock_timestamp(),
 primary key(family_id,actor_id,id),
 foreign key(family_id,actor_id) references scrabble.memberships(family_id,user_id)
);
create index usage_actor_recent on scrabble.usage_pulses(family_id,actor_id,received_at desc);
create index usage_report_range on scrabble.usage_pulses(family_id,received_at desc,id);
alter table scrabble.usage_pulses enable row level security;
revoke all on scrabble.usage_pulses from public,anon,authenticated,service_role;
grant select,insert on scrabble.usage_pulses to scrabble_runtime;
-- The writer needs its own last receipt to cap overlapping tabs/devices. Reports
-- additionally require a fresh superadmin membership in the server repository.
create policy usage_read on scrabble.usage_pulses for select to scrabble_runtime
 using (scrabble.is_member(family_id) and (actor_id=scrabble.actor_id() or scrabble.is_member(family_id,true)));
create policy usage_insert on scrabble.usage_pulses for insert to scrabble_runtime
 with check (scrabble.is_member(family_id) and actor_id=scrabble.actor_id());
create trigger usage_immutable before update or delete or truncate on scrabble.usage_pulses
 for each statement execute function scrabble.prevent_erasure();
-- Preserve the owner-only Gym RLS. This narrow privileged projection is needed
-- to report action metadata without granting superadmins raw practice payloads.
create function scrabble.usage_gym_actions(range_start timestamptz, range_end timestamptz)
returns table(id text, at timestamptz, actor_id uuid, action text, subject text)
language sql stable security definer set search_path = '' as $$
 select 'gym:'||e.id::text,e.received_at,s.actor_id,
   'gym:'||coalesce(e.event->'payload'->>'type','action'),e.session_id::text
 from scrabble.gym_events e join scrabble.gym_sessions s
   on s.family_id=e.family_id and s.player_id=e.player_id and s.id=e.session_id
 where scrabble.is_member(scrabble.family_id(),true)
   and e.family_id=scrabble.family_id()
   and range_end>range_start and range_end-range_start<=interval '31 days'
   and e.received_at>=range_start and e.received_at<range_end
$$;
revoke all on function scrabble.usage_gym_actions(timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function scrabble.usage_gym_actions(timestamptz,timestamptz) to scrabble_runtime;
create index game_events_report_range on scrabble.game_events(family_id,recorded_at desc);
create index gym_events_report_range on scrabble.gym_events(family_id,received_at desc);
commit;
