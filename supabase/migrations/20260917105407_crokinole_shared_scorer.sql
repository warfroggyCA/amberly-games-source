begin;
create table scrabble.crokinole_games (
 family_id uuid not null references scrabble.families(id), game_id text not null,
 definition jsonb not null, state jsonb not null, revision integer not null check(revision>=0),
 scorer_user_id uuid not null, generation integer not null default 1 check(generation>=1),
 mode text not null check(mode in ('confirmed','practice')),
 removed boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(family_id,game_id), foreign key(family_id,scorer_user_id) references scrabble.memberships(family_id,user_id),
 check(jsonb_typeof(definition)='object' and jsonb_typeof(state)='object')
);
create index crokinole_recent on scrabble.crokinole_games(family_id,created_at desc,game_id);
create table scrabble.crokinole_events (
 family_id uuid not null,game_id text not null,sequence integer not null check(sequence>0),event jsonb not null,
 primary key(family_id,game_id,sequence),foreign key(family_id,game_id) references scrabble.crokinole_games(family_id,game_id)
);
create table scrabble.crokinole_drafts (
 family_id uuid not null,game_id text not null,scorer_user_id uuid not null,generation integer not null check(generation>=0),revision integer not null check(revision>=0),payload jsonb,
 primary key(family_id,game_id,generation),foreign key(family_id,game_id) references scrabble.crokinole_games(family_id,game_id),
 foreign key(family_id,scorer_user_id) references scrabble.memberships(family_id,user_id)
);
create table scrabble.crokinole_palette (
 family_id uuid primary key references scrabble.families(id),revision integer not null check(revision>=0),colours jsonb not null check(jsonb_typeof(colours)='array' and jsonb_array_length(colours)<=64)
);
create table scrabble.crokinole_concerns (
 family_id uuid not null,game_id text not null,id uuid not null,concern jsonb not null,
 primary key(family_id,id),foreign key(family_id,game_id) references scrabble.crokinole_games(family_id,game_id)
);
do $$ declare t text; begin
 foreach t in array array['crokinole_games','crokinole_events','crokinole_drafts','crokinole_palette','crokinole_concerns'] loop
 execute format('alter table scrabble.%I enable row level security',t);
 execute format('revoke all on scrabble.%I from public,anon,authenticated,service_role',t);
 execute format('grant select,insert on scrabble.%I to scrabble_runtime',t);
 execute format('create trigger no_erasure before delete or truncate on scrabble.%I for each statement execute function scrabble.prevent_erasure()',t);
 end loop;
end $$;
grant update on scrabble.crokinole_games,scrabble.crokinole_drafts,scrabble.crokinole_palette,scrabble.crokinole_concerns to scrabble_runtime;
create policy read_games on scrabble.crokinole_games for select to scrabble_runtime using(scrabble.is_member(family_id) and (mode='confirmed' or scrabble.is_member(family_id,true)));
create policy create_games on scrabble.crokinole_games for insert to scrabble_runtime with check(scrabble.has_permission(family_id,'startGames') and scrabble.has_permission(family_id,'scoreGames') and scorer_user_id=scrabble.actor_id() and (mode='confirmed' or scrabble.is_member(family_id,true)));
create policy write_games on scrabble.crokinole_games for update to scrabble_runtime using(scrabble.has_permission(family_id,'scoreGames') and (scorer_user_id=scrabble.actor_id() or scrabble.has_permission(family_id,'takeOverScoring')) and (mode='confirmed' or scrabble.is_member(family_id,true))) with check(scrabble.has_permission(family_id,'scoreGames') and (scorer_user_id=scrabble.actor_id() or scrabble.has_permission(family_id,'takeOverScoring')) and (mode='confirmed' or scrabble.is_member(family_id,true)));
create policy read_events on scrabble.crokinole_events for select to scrabble_runtime using(exists(select 1 from scrabble.crokinole_games g where g.family_id=crokinole_events.family_id and g.game_id=crokinole_events.game_id));
create policy insert_events on scrabble.crokinole_events for insert to scrabble_runtime with check(scrabble.has_permission(family_id,'scoreGames') and exists(select 1 from scrabble.crokinole_games g where g.family_id=crokinole_events.family_id and g.game_id=crokinole_events.game_id and g.scorer_user_id=scrabble.actor_id() and not g.removed));
create trigger immutable_event before update on scrabble.crokinole_events for each statement execute function scrabble.prevent_erasure();
create policy read_drafts on scrabble.crokinole_drafts for select to scrabble_runtime using(scorer_user_id=scrabble.actor_id() and scrabble.has_permission(family_id,'scoreGames') and exists(select 1 from scrabble.crokinole_games g where g.family_id=crokinole_drafts.family_id and g.game_id=crokinole_drafts.game_id and g.scorer_user_id=scrabble.actor_id() and not g.removed));
-- Transfer may retire the previous scorer's draft, but never read it.
create policy insert_drafts on scrabble.crokinole_drafts for insert to scrabble_runtime with check(scorer_user_id=scrabble.actor_id() and scrabble.has_permission(family_id,'scoreGames') and exists(select 1 from scrabble.crokinole_games g where g.family_id=crokinole_drafts.family_id and g.game_id=crokinole_drafts.game_id and g.scorer_user_id=scrabble.actor_id() and not g.removed));
create policy update_drafts on scrabble.crokinole_drafts for update to scrabble_runtime using(scrabble.has_permission(family_id,'scoreGames') and exists(select 1 from scrabble.crokinole_games g where g.family_id=crokinole_drafts.family_id and g.game_id=crokinole_drafts.game_id and g.scorer_user_id=scrabble.actor_id() and not g.removed)) with check(scorer_user_id=scrabble.actor_id());
create policy read_palette on scrabble.crokinole_palette for select to scrabble_runtime using(scrabble.is_member(family_id));
create policy insert_palette on scrabble.crokinole_palette for insert to scrabble_runtime with check(scrabble.has_permission(family_id,'manageEquipment'));
create policy update_palette on scrabble.crokinole_palette for update to scrabble_runtime using(scrabble.has_permission(family_id,'manageEquipment')) with check(scrabble.has_permission(family_id,'manageEquipment'));
create policy read_concerns on scrabble.crokinole_concerns for select to scrabble_runtime using(exists(select 1 from scrabble.crokinole_games g where g.family_id=crokinole_concerns.family_id and g.game_id=crokinole_concerns.game_id and (not g.removed or scrabble.is_member(g.family_id,true))));
create policy insert_concerns on scrabble.crokinole_concerns for insert to scrabble_runtime with check(scrabble.is_member(family_id) and exists(select 1 from scrabble.crokinole_games g where g.family_id=crokinole_concerns.family_id and g.game_id=crokinole_concerns.game_id and not g.removed));
create policy update_concerns on scrabble.crokinole_concerns for update to scrabble_runtime using(scrabble.has_permission(family_id,'resolveConcerns')) with check(scrabble.has_permission(family_id,'resolveConcerns'));
create function scrabble.protect_crokinole_definition() returns trigger language plpgsql set search_path='' as $$ begin
 if new.definition is distinct from old.definition or new.family_id<>old.family_id or new.game_id<>old.game_id or new.mode<>old.mode or (old.removed and not new.removed) then raise exception 'Crokinole definitions and removals are immutable'; end if;
 if new.removed and (new.mode<>'practice' or not scrabble.is_member(new.family_id,true)) then raise exception 'Only superadmins may remove private test games'; end if;
 return new;
end $$;
revoke all on function scrabble.protect_crokinole_definition() from public,anon,authenticated,service_role;
create trigger protect_definition before update on scrabble.crokinole_games for each row execute function scrabble.protect_crokinole_definition();
commit;
