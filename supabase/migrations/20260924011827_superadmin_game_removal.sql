-- Removal is a terminal administrative state, not a scored finish. Preserve journals/results.
begin;
alter policy admin_remove on scrabble.game_removals with check(
 scrabble.is_member(family_id,true) and actor_id=scrabble.actor_id() and exists(
  select 1 from scrabble.game_definitions d join scrabble.game_heads h using(family_id,game_id)
  where d.family_id=game_removals.family_id and d.game_id=game_removals.game_id and h.revision=game_removals.game_revision));
create or replace function scrabble.protect_crokinole_definition() returns trigger language plpgsql set search_path='' as $$ begin
 if new.definition is distinct from old.definition or new.family_id<>old.family_id or new.game_id<>old.game_id or new.mode<>old.mode or (old.removed and not new.removed) then raise exception 'Crokinole definitions and removals are immutable'; end if;
 if new.removed and not scrabble.is_member(new.family_id,true) then raise exception 'Only superadmins may remove games'; end if;
 return new;
end $$;
create function scrabble.application_schema_v2() returns integer language sql immutable set search_path='' as $$ select 2 $$;
revoke all on function scrabble.application_schema_v2() from public,anon,authenticated,service_role;
grant execute on function scrabble.application_schema_v2() to scrabble_runtime;
commit;
