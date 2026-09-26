begin;

-- Never certify a partial rollout (hosted migration timestamps may differ).
do $$
begin
  if to_regprocedure('scrabble.complete_player_profile(text,integer,integer,jsonb)') is null or
     not exists(select 1 from pg_catalog.pg_attribute where attrelid=to_regclass('scrabble.players') and attname='nickname' and not attisdropped) or
     not exists(select 1 from pg_catalog.pg_attribute where attrelid=to_regclass('scrabble.invitations') and attname='player_id' and not attisdropped) or
     not exists(select 1 from pg_catalog.pg_attribute where attrelid=to_regclass('scrabble.crokinole_palette') and attname='defaults' and not attisdropped) then
    raise exception 'Apply all prerequisite Amberly migrations before integrity guards';
  end if;
end $$;

-- Application checks this capability before accessing the current schema. Its
-- presence certifies the complete ordered migration set, not provider timestamps.
create function scrabble.application_schema_v1() returns integer
language sql immutable set search_path='' as $$ select 1 $$;
revoke all on function scrabble.application_schema_v1() from public,anon,authenticated,service_role;
grant execute on function scrabble.application_schema_v1() to scrabble_runtime;

alter policy head_update on scrabble.game_heads
using (scrabble.has_permission(family_id,'scoreGames') and
  (scorer_user_id=scrabble.actor_id() or scrabble.has_permission(family_id,'takeOverScoring')))
with check (scrabble.has_permission(family_id,'scoreGames') and
  (scorer_user_id=scrabble.actor_id() or scrabble.has_permission(family_id,'takeOverScoring')));

-- Existing event IDs are retained. Conflicting historic IDs fail the migration
-- atomically and require investigation; no records are silently repaired.
alter table scrabble.crokinole_events
  add column command_id text generated always as (event->'command'->>'id') stored,
  add constraint crokinole_command_unique unique(family_id,game_id,command_id),
  add constraint crokinole_event_shape check (
    command_id is not null and length(command_id) between 1 and 120 and
    event->>'sequence' is not null and event->'command'->>'expectedRevision' is not null and
    (event->>'sequence')::integer=sequence and
    (event->'command'->>'expectedRevision')::integer=sequence-1);

-- Projection changes must append exactly one immutable event. Ownership and
-- removal updates remain possible without modifying scores or their revision.
create function scrabble.protect_crokinole_projection() returns trigger
language plpgsql set search_path='' as $$
declare journal jsonb;
begin
  if tg_op='UPDATE' then
    if new.state is not distinct from old.state and new.revision=old.revision then return new; end if;
    if new.revision<>old.revision+1 then
      raise exception 'Crokinole projection changes require the next journal event';
    end if;
  elsif new.revision<>0 then
    raise exception 'New Crokinole games must start at revision zero';
  end if;
  select coalesce(jsonb_agg(event order by sequence),'[]'::jsonb) into journal
    from scrabble.crokinole_events where family_id=new.family_id and game_id=new.game_id;
  if new.state->'definition' is distinct from new.definition or
     new.state->'revision' is distinct from to_jsonb(new.revision) or
     new.state->'events' is distinct from journal or
     jsonb_array_length(journal)<>new.revision or
     (new.revision>0 and new.state->'result' is distinct from journal->-1->'result') then
    raise exception 'Crokinole projection must match its journal';
  end if;
  return new;
end $$;
revoke all on function scrabble.protect_crokinole_projection() from public,anon,authenticated,service_role;
create trigger protect_projection before insert or update on scrabble.crokinole_games
for each row execute function scrabble.protect_crokinole_projection();

-- Also reject appending an event without advancing the head in the transaction.
create function scrabble.check_crokinole_event_head() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from scrabble.crokinole_games g
    where g.family_id=new.family_id and g.game_id=new.game_id
    and g.revision>=new.sequence and g.state->'events'->(new.sequence-1)=new.event) then
    raise exception 'Crokinole event requires its matching projection';
  end if;
  return null;
end $$;
revoke all on function scrabble.check_crokinole_event_head() from public,anon,authenticated,service_role;
create constraint trigger event_requires_head after insert on scrabble.crokinole_events
  deferrable initially deferred for each row execute function scrabble.check_crokinole_event_head();

-- Keep the existing concern format and all historic resolutions. A resolver may
-- append one resolution, never rewrite the reporter's evidence or resolve twice.
create function scrabble.protect_crokinole_concern() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.family_id<>old.family_id or new.game_id<>old.game_id or new.id<>old.id or
     (new.concern-'resolution') is distinct from (old.concern-'resolution') or
     old.concern->'resolution' is distinct from 'null'::jsonb or
     jsonb_typeof(new.concern->'resolution') is distinct from 'object' or
     new.concern->'resolution'->>'resolvedBy' is distinct from scrabble.actor_id()::text or
     new.concern->'resolution'->>'outcome' is null or
     (new.concern->'resolution'->>'resolvedAt')::timestamptz is null or
     new.concern->'resolution'->>'outcome' not in ('dismissed','upheld') or
     coalesce(length(trim(new.concern->'resolution'->>'reason')),0) not between 1 and 500 then
    raise exception 'Concern evidence and existing resolutions are immutable';
  end if;
  return new;
end $$;
revoke all on function scrabble.protect_crokinole_concern() from public,anon,authenticated,service_role;
create trigger protect_concern before update on scrabble.crokinole_concerns
for each row execute function scrabble.protect_crokinole_concern();
commit;
