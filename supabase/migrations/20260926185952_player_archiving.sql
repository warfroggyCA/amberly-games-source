begin;
alter table scrabble.players add column if not exists archived boolean not null default false;

-- Reserve removed IDs so a delayed create retry cannot resurrect a deleted profile.
create table if not exists scrabble.deleted_player_ids (
 family_id uuid not null references scrabble.families(id), player_id text not null,
 deleted_at timestamptz not null default now(), primary key(family_id,player_id)
);
alter table scrabble.deleted_player_ids enable row level security;
revoke all on scrabble.deleted_player_ids from public,anon,authenticated,service_role;
grant select,insert on scrabble.deleted_player_ids to scrabble_runtime;
drop policy if exists member_read on scrabble.deleted_player_ids;
create policy member_read on scrabble.deleted_player_ids for select to scrabble_runtime using(scrabble.is_member(family_id));
drop policy if exists admin_insert on scrabble.deleted_player_ids;
create policy admin_insert on scrabble.deleted_player_ids for insert to scrabble_runtime with check(scrabble.is_member(family_id,true));
drop trigger if exists no_erasure on scrabble.deleted_player_ids;
create trigger no_erasure before delete or truncate on scrabble.deleted_player_ids for each statement execute function scrabble.prevent_erasure();
drop trigger if exists immutable_update on scrabble.deleted_player_ids;
create trigger immutable_update before update on scrabble.deleted_player_ids for each statement execute function scrabble.prevent_erasure();

create or replace function scrabble.player_deletion_block(f uuid,p text) returns text
language sql stable security invoker set search_path='' as $$
 select case
 when exists(select 1 from scrabble.memberships where family_id=f and player_id=p) then 'This player has a linked account. Keep them archived; sign-in access is managed separately.'
 when exists(select 1 from scrabble.invitations where family_id=f and player_id=p) then 'This player has an invitation record. Keep them archived to preserve the account link.'
 when exists(select 1 from scrabble.game_participants where family_id=f and player_id=p)
   or exists(select 1 from scrabble.game_definitions where family_id=f and definition->'players' @> jsonb_build_array(jsonb_build_object('id',p)))
   or exists(select 1 from scrabble.crokinole_games where family_id=f and definition->'players' @> jsonb_build_array(jsonb_build_object('id',p)))
 then 'This player has saved game history. Archiving keeps those results intact.'
 when exists(select 1 from scrabble.gym_sessions where family_id=f and player_id=p) then 'This player has Gym history. Archiving keeps their progress intact.'
 else null end
$$;
revoke all on function scrabble.player_deletion_block(uuid,text) from public;
grant execute on function scrabble.player_deletion_block(uuid,text) to scrabble_runtime;

create or replace function scrabble.guard_player_lifecycle() returns trigger
language plpgsql security invoker set search_path='' as $$
declare blocked text;
begin
 if TG_OP='INSERT' then
   if NEW.archived or exists(select 1 from scrabble.deleted_player_ids where family_id=NEW.family_id and player_id=NEW.id) then
     raise exception 'Create a new active player with a new ID' using errcode='23514';
   end if;
   return NEW;
 end if;
 if TG_OP='UPDATE' then
   if NEW.archived is distinct from OLD.archived and not scrabble.is_member(OLD.family_id,true) then
     raise exception 'Only a superadmin can archive or restore players' using errcode='42501';
   end if;
   return NEW;
 end if;
 if not scrabble.is_member(OLD.family_id,true) or not OLD.archived then
   raise exception 'Only a superadmin can delete an archived player' using errcode='42501';
 end if;
 perform id from scrabble.families where id=OLD.family_id for update;
 blocked:=scrabble.player_deletion_block(OLD.family_id,OLD.id);
 if blocked is not null then raise exception '%',blocked using errcode='23503'; end if;
 insert into scrabble.deleted_player_ids(family_id,player_id) values(OLD.family_id,OLD.id);
 return OLD;
end $$;
revoke all on function scrabble.guard_player_lifecycle() from public;
grant execute on function scrabble.guard_player_lifecycle() to scrabble_runtime;
drop trigger if exists player_lifecycle on scrabble.players;
create trigger player_lifecycle before insert or update or delete on scrabble.players for each row execute function scrabble.guard_player_lifecycle();
drop trigger if exists no_erasure on scrabble.players;
create trigger no_erasure before truncate on scrabble.players for each statement execute function scrabble.prevent_erasure();
grant delete on scrabble.players to scrabble_runtime;
drop policy if exists player_delete on scrabble.players;
create policy player_delete on scrabble.players for delete to scrabble_runtime using(scrabble.is_member(family_id,true) and archived);
create or replace function scrabble.application_schema_v3() returns boolean language sql stable set search_path='' as $$ select true $$;
revoke all on function scrabble.application_schema_v3() from public;
grant execute on function scrabble.application_schema_v3() to scrabble_runtime;
commit;
