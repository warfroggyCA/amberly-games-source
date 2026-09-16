-- Private application schema. Apply as the migration owner, never with runtime credentials.
-- Grant scrabble_runtime to a dedicated LOGIN role outside this migration. Do not expose
-- this schema through the Supabase Data API and do not use postgres/service_role at runtime.
begin;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'scrabble_runtime') then
    create role scrabble_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
create schema scrabble;
revoke all on schema scrabble from public;
grant usage on schema scrabble to scrabble_runtime;
alter default privileges in schema scrabble revoke execute on functions from public;

create table scrabble.families (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create table scrabble.players (
  family_id uuid not null references scrabble.families(id),
  id text not null check (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
  name text not null check (char_length(name) between 1 and 60),
  bio text not null default '' check (char_length(bio) <= 240),
  photo_data_url text check (char_length(photo_data_url) <= 273091 and photo_data_url like 'data:image/jpeg;base64,%'),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  primary key (family_id, id)
);
create table scrabble.memberships (
  family_id uuid not null references scrabble.families(id),
  user_id uuid not null,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role text not null check (role in ('member', 'superadmin')),
  active boolean not null default true,
  player_id text,
  revision integer not null default 0 check (revision >= 0),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id),
  unique (family_id, email),
  unique (family_id, player_id),
  foreign key (family_id, player_id) references scrabble.players(family_id, id)
);
create table scrabble.invitations (
  family_id uuid not null references scrabble.families(id),
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  active boolean not null default true,
  accepted_by uuid,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  primary key (family_id, email)
);
create table scrabble.game_definitions (
  family_id uuid not null references scrabble.families(id),
  game_id text not null check (game_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
  mode text not null check (mode in ('confirmed', 'practice')),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (family_id, game_id),
  foreign key (family_id, created_by) references scrabble.memberships(family_id, user_id)
);
create table scrabble.game_heads (
  family_id uuid not null,
  game_id text not null,
  revision integer not null check (revision between 0 and 5000),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  scorer_user_id uuid not null,
  scorer_device_hash text not null check (scorer_device_hash ~ '^[a-f0-9]{64}$'),
  scorer_device_id text not null check (char_length(scorer_device_id) between 1 and 120),
  scorer_generation integer not null default 1 check (scorer_generation > 0),
  updated_at timestamptz not null default now(),
  primary key (family_id, game_id),
  foreign key (family_id, game_id) references scrabble.game_definitions(family_id, game_id),
  foreign key (family_id, scorer_user_id) references scrabble.memberships(family_id, user_id)
);
create index game_heads_updated on scrabble.game_heads(family_id, updated_at desc, game_id);
create table scrabble.game_events (
  family_id uuid not null,
  game_id text not null,
  sequence integer not null check (sequence between 1 and 5000),
  command_id text not null,
  event jsonb not null check (jsonb_typeof(event) = 'object'),
  actor_id uuid not null,
  recorded_at timestamptz not null default now(),
  primary key (family_id, game_id, sequence),
  unique (family_id, game_id, command_id),
  foreign key (family_id, game_id) references scrabble.game_definitions(family_id, game_id),
  foreign key (family_id, actor_id) references scrabble.memberships(family_id, user_id)
);
create table scrabble.game_results (
  family_id uuid not null,
  game_id text not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  recorded_at timestamptz not null default now(),
  primary key (family_id, game_id),
  foreign key (family_id, game_id) references scrabble.game_definitions(family_id, game_id)
);
-- The account linked at game creation remains the consenting identity even if a
-- superadmin later links that player profile to someone else.
create table scrabble.game_participants (
  family_id uuid not null,
  game_id text not null,
  player_id text not null,
  user_id uuid,
  primary key(family_id, game_id, player_id),
  unique(family_id, game_id, user_id),
  foreign key(family_id, game_id) references scrabble.game_definitions(family_id, game_id),
  foreign key(family_id, player_id) references scrabble.players(family_id, id),
  foreign key(family_id, user_id) references scrabble.memberships(family_id, user_id)
);
create table scrabble.game_approvals (
  family_id uuid not null,
  game_id text not null,
  player_id text not null,
  stage text not null check(stage in ('start', 'result')),
  revision integer not null check(revision between 0 and 5000),
  actor_id uuid not null,
  approved_at timestamptz not null default now(),
  primary key(family_id, game_id, player_id, stage),
  foreign key(family_id, game_id, player_id) references scrabble.game_participants(family_id, game_id, player_id),
  foreign key(family_id, actor_id) references scrabble.memberships(family_id, user_id)
);
-- Read-only guest capability; plaintext link tokens are never stored.
create table scrabble.watch_links (
  family_id uuid not null,
  game_id text not null,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  active boolean not null default true,
  expires_at timestamptz not null,
  revision integer not null default 0 check(revision >= 0),
  created_at timestamptz not null default now(),
  primary key(family_id,game_id),
  foreign key(family_id,game_id) references scrabble.game_definitions(family_id,game_id),
  foreign key(family_id,created_by) references scrabble.memberships(family_id,user_id)
);
create table scrabble.verified_words (
  family_id uuid not null references scrabble.families(id),
  word text not null check (word ~ '^[A-Z]{2,15}$'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  verified_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (family_id, word),
  foreign key (family_id, verified_by) references scrabble.memberships(family_id, user_id)
);
create table scrabble.audit (
  family_id uuid not null references scrabble.families(id),
  id uuid primary key,
  actor_id uuid not null,
  action text not null,
  subject text not null,
  before_value jsonb,
  after_value jsonb,
  recorded_at timestamptz not null default now(),
  foreign key (family_id, actor_id) references scrabble.memberships(family_id, user_id)
);
create index audit_family_date on scrabble.audit(family_id, recorded_at desc, id);
create table scrabble.requests (
  family_id uuid not null,
  actor_id uuid not null,
  request_id text not null check (char_length(request_id) between 1 and 120),
  fingerprint text not null check (char_length(fingerprint) = 64),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (family_id, actor_id, request_id),
  foreign key (family_id, actor_id) references scrabble.memberships(family_id, user_id)
);

create function scrabble.actor_id() returns uuid language sql stable
set search_path = '' as $$ select nullif(current_setting('scrabble.actor_id', true), '')::uuid $$;
create function scrabble.family_id() returns uuid language sql stable
set search_path = '' as $$ select nullif(current_setting('scrabble.family_id', true), '')::uuid $$;
-- This internal lookup intentionally bypasses memberships RLS to avoid policy recursion.
-- Claims are set only by the verified server transaction; no browser role can call it.
create function scrabble.is_member(target uuid, admin_only boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select scrabble.actor_id() is not null and target = scrabble.family_id() and exists (
    select 1 from scrabble.memberships m where m.family_id = target and m.user_id = scrabble.actor_id()
      and m.active and (not admin_only or m.role = 'superadmin')
  )
$$;
create function scrabble.owns_player(target uuid, player text) returns boolean
language sql stable security definer set search_path = '' as $$
  select scrabble.actor_id() is not null and target = scrabble.family_id() and exists (
    select 1 from scrabble.memberships m where m.family_id = target and m.user_id = scrabble.actor_id()
      and m.active and m.player_id = player
  )
$$;
-- Explicit admission, callable only by the trusted server after getUser verifies email.
-- The family lock also serializes invitation revocation and last-superadmin decisions.
create function scrabble.admit_member() returns boolean
language plpgsql security definer set search_path = '' as $$
declare invite scrabble.invitations; existing scrabble.memberships; email_claim text;
begin
  if scrabble.actor_id() is null or scrabble.family_id() is null
    or current_setting('scrabble.email_verified', true) is distinct from 'true' then
    raise exception 'Verified identity required' using errcode = '42501';
  end if;
  email_claim := lower(nullif(current_setting('scrabble.actor_email', true), ''));
  if email_claim is null then raise exception 'Verified email required' using errcode = '42501'; end if;
  perform 1 from scrabble.families where id = scrabble.family_id() for update;
  select * into existing from scrabble.memberships where family_id = scrabble.family_id() and user_id = scrabble.actor_id();
  if found then return existing.active; end if;
  select * into invite from scrabble.invitations where family_id = scrabble.family_id() and email = email_claim for update;
  if not found or not invite.active or invite.accepted_by is not null then return false; end if;
  insert into scrabble.memberships(family_id, user_id, email, role) values(scrabble.family_id(), scrabble.actor_id(), email_claim, 'member');
  update scrabble.invitations set accepted_by = scrabble.actor_id(), active = false, revision = revision + 1
    where family_id = scrabble.family_id() and email = email_claim;
  insert into scrabble.audit(family_id, id, actor_id, action, subject, after_value)
    values(scrabble.family_id(), gen_random_uuid(), scrabble.actor_id(), 'member.admitted', scrabble.actor_id()::text,
      jsonb_build_object('email', email_claim, 'role', 'member'));
  return true;
end $$;

-- Deliberately permits an unauthenticated server request with the unguessable
-- capability hash. Only the restricted backend role may call it; it exposes a
-- small read-only projection and never delegates membership or scoring rights.
create function scrabble.read_watch(target_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',h.state->'id','players',h.state->'players','board',h.state->'board',
    'scores',h.state->'scores','turns',h.state->'turns','order',h.state->'order',
    'status',h.state->'status','pendingEnd',h.state->'pendingEnd',
    'currentPlayerId',h.state->'currentPlayerId',
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

-- Fail even if a future grant accidentally widens runtime rights. Migration owners retain
-- deliberate repair ability; runtime cannot change original history or remove profiles.
create function scrabble.prevent_erasure() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'History is append-only' using errcode = '42501'; end $$;

do $$ declare t text; begin
  foreach t in array array['families','players','memberships','invitations','watch_links','game_definitions','game_heads','game_events','game_results','game_participants','game_approvals','verified_words','audit','requests'] loop
    execute format('alter table scrabble.%I enable row level security', t);
    execute format('revoke all on table scrabble.%I from public', t);
    execute format('create trigger no_erasure before delete or truncate on scrabble.%I for each statement execute function scrabble.prevent_erasure()', t);
    if t <> 'families' then
      execute format('create policy member_read on scrabble.%I for select to scrabble_runtime using (scrabble.is_member(family_id))', t);
    end if;
  end loop;
  foreach t in array array['game_definitions','game_events','game_results','game_participants','game_approvals','verified_words','audit','requests'] loop
    execute format('grant select, insert on scrabble.%I to scrabble_runtime', t);
    if t <> 'game_approvals' then
      execute format('create policy member_insert on scrabble.%I for insert to scrabble_runtime with check (scrabble.is_member(family_id)%s)', t,
        case when t in ('game_events','audit','requests') then ' and actor_id = scrabble.actor_id()'
          when t = 'game_definitions' then ' and created_by = scrabble.actor_id()'
          when t = 'verified_words' then ' and verified_by = scrabble.actor_id()' else '' end);
    end if;
    execute format('create trigger immutable_update before update on scrabble.%I for each statement execute function scrabble.prevent_erasure()', t);
  end loop;
end $$;
create policy participant_approval on scrabble.game_approvals for insert to scrabble_runtime
 with check (scrabble.is_member(family_id) and actor_id = scrabble.actor_id() and exists (
   select 1 from scrabble.game_participants p where p.family_id = game_approvals.family_id
    and p.game_id = game_approvals.game_id and p.player_id = game_approvals.player_id and p.user_id = scrabble.actor_id()
 ) and exists (
   select 1 from scrabble.game_heads h where h.family_id=game_approvals.family_id and h.game_id=game_approvals.game_id
    and h.revision=game_approvals.revision
    and ((game_approvals.stage='result' and h.state->>'status'='finalized')
      or (game_approvals.stage='start' and h.state->>'status'<>'finalized' and jsonb_array_length(h.state->'turns')=0))
 ));
create policy family_read on scrabble.families for select to scrabble_runtime using (scrabble.is_member(id));
-- FOR UPDATE requires UPDATE privilege; no UPDATE policy permits an actual family change.
grant select, update on scrabble.families to scrabble_runtime;
create policy family_lock on scrabble.families for update to scrabble_runtime
 using (scrabble.is_member(id)) with check (false);
grant select, insert, update on scrabble.players, scrabble.memberships, scrabble.invitations, scrabble.game_heads, scrabble.watch_links to scrabble_runtime;
create policy watch_insert on scrabble.watch_links for insert to scrabble_runtime
 with check(scrabble.is_member(family_id) and created_by=scrabble.actor_id() and
   (scrabble.is_member(family_id,true) or exists(select 1 from scrabble.game_heads h where h.family_id=watch_links.family_id and h.game_id=watch_links.game_id and h.scorer_user_id=scrabble.actor_id())));
create policy watch_update on scrabble.watch_links for update to scrabble_runtime
 using(scrabble.is_member(family_id) and (scrabble.is_member(family_id,true) or exists(select 1 from scrabble.game_heads h where h.family_id=watch_links.family_id and h.game_id=watch_links.game_id and h.scorer_user_id=scrabble.actor_id())))
 with check(scrabble.is_member(family_id));
create policy player_insert on scrabble.players for insert to scrabble_runtime with check (scrabble.is_member(family_id));
create policy player_update on scrabble.players for update to scrabble_runtime
 using (scrabble.is_member(family_id, true) or scrabble.owns_player(family_id, id))
 with check (scrabble.is_member(family_id, true) or scrabble.owns_player(family_id, id));
create policy member_update on scrabble.memberships for update to scrabble_runtime
 using (scrabble.is_member(family_id, true)) with check (family_id = scrabble.family_id());
create policy invite_insert on scrabble.invitations for insert to scrabble_runtime with check (scrabble.is_member(family_id, true));
create policy invite_update on scrabble.invitations for update to scrabble_runtime
 using (scrabble.is_member(family_id, true)) with check (scrabble.is_member(family_id, true));
create policy head_insert on scrabble.game_heads for insert to scrabble_runtime with check (scrabble.is_member(family_id) and scorer_user_id = scrabble.actor_id());
create policy head_update on scrabble.game_heads for update to scrabble_runtime
 using (scrabble.is_member(family_id)) with check (scrabble.is_member(family_id));
revoke all on all functions in schema scrabble from public;
grant execute on function scrabble.actor_id(), scrabble.family_id(), scrabble.is_member(uuid, boolean), scrabble.owns_player(uuid, text), scrabble.admit_member(), scrabble.read_watch(text) to scrabble_runtime;
-- Supabase browser roles may not exist in standalone PostgreSQL integration tests.
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema scrabble from %I', r);
      execute format('revoke all on all tables in schema scrabble from %I', r);
      execute format('revoke all on all functions in schema scrabble from %I', r);
    end if;
  end loop;
end $$;
commit;
