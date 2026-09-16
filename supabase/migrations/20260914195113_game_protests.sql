-- Additive review history. Original games, results and legacy approvals remain untouched.
begin;
create table scrabble.game_protests (
  family_id uuid not null,
  game_id text not null,
  id uuid not null,
  reason text not null check(char_length(reason) between 1 and 2000 and btrim(reason)=reason and translate(reason,E'\t\n\r','') !~ '[[:cntrl:]]'),
  reported_for text check(char_length(reported_for) between 1 and 60 and btrim(reported_for)=reported_for and reported_for !~ '[[:cntrl:]]'),
  reporter_id uuid not null,
  reported_by text not null check(char_length(reported_by) between 1 and 120),
  reported_at timestamptz not null default now(),
  game_revision integer not null check(game_revision between 0 and 5000),
  primary key(family_id,game_id,id),
  foreign key(family_id,game_id) references scrabble.game_definitions(family_id,game_id),
  foreign key(family_id,reporter_id) references scrabble.memberships(family_id,user_id)
);
create index protests_family_game on scrabble.game_protests(family_id,game_id,reported_at,id);
create table scrabble.game_protest_resolutions (
  family_id uuid not null,
  game_id text not null,
  protest_id uuid not null,
  outcome text not null check(outcome in ('dismissed','upheld')),
  reason text not null check(char_length(reason) between 1 and 2000 and btrim(reason)=reason and translate(reason,E'\t\n\r','') !~ '[[:cntrl:]]'),
  resolver_id uuid not null,
  resolved_by text not null check(char_length(resolved_by) between 1 and 120),
  resolved_at timestamptz not null default now(),
  primary key(family_id,game_id,protest_id),
  foreign key(family_id,game_id,protest_id) references scrabble.game_protests(family_id,game_id,id),
  foreign key(family_id,resolver_id) references scrabble.memberships(family_id,user_id)
);

do $$ declare t text; r text; begin
  foreach t in array array['game_protests','game_protest_resolutions'] loop
    execute format('alter table scrabble.%I enable row level security',t);
    execute format('revoke all on table scrabble.%I from public',t);
    execute format('grant select,insert on scrabble.%I to scrabble_runtime',t);
    execute format('create policy family_read on scrabble.%I for select to scrabble_runtime using(scrabble.is_member(family_id))',t);
    execute format('create trigger no_erasure before delete or truncate on scrabble.%I for each statement execute function scrabble.prevent_erasure()',t);
    execute format('create trigger immutable_update before update on scrabble.%I for each statement execute function scrabble.prevent_erasure()',t);
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_roles where rolname=r) then
        execute format('revoke all on table scrabble.%I from %I',t,r);
      end if;
    end loop;
  end loop;
end $$;
create policy member_report on scrabble.game_protests for insert to scrabble_runtime
 with check(scrabble.is_member(family_id) and reporter_id=scrabble.actor_id() and exists(
   select 1 from scrabble.game_heads h where h.family_id=game_protests.family_id
    and h.game_id=game_protests.game_id and h.revision=game_protests.game_revision
 ));
create policy admin_resolution on scrabble.game_protest_resolutions for insert to scrabble_runtime
 with check(scrabble.is_member(family_id,true) and resolver_id=scrabble.actor_id());
commit;
