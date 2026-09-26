-- Private, append-only practice history. Existing game schemas/capability remain unchanged.
create table scrabble.gym_sessions (
 family_id uuid not null, player_id text not null, id uuid not null,
 actor_id uuid not null, fingerprint text not null check(length(fingerprint)=64),
 puzzle jsonb not null check(jsonb_typeof(puzzle)='object' and octet_length(puzzle::text)<=100000),
 replay boolean not null, created_at timestamptz not null default clock_timestamp(),
 primary key(family_id,player_id,id),
 foreign key(family_id,player_id) references scrabble.players(family_id,id),
 foreign key(family_id,actor_id) references scrabble.memberships(family_id,user_id)
);
create index gym_history_page on scrabble.gym_sessions(family_id,player_id,created_at desc,id desc);
create index gym_exposure on scrabble.gym_sessions(family_id,player_id,fingerprint);
create table scrabble.gym_events (
 family_id uuid not null, player_id text not null, session_id uuid not null,
 id uuid not null, sequence integer not null check(sequence between 1 and 1000),
 payload_hash text not null check(length(payload_hash)=64),
 event jsonb not null check(jsonb_typeof(event)='object' and octet_length(event::text)<=16000),
 received_at timestamptz not null default clock_timestamp(),
 primary key(family_id,player_id,id), unique(family_id,player_id,session_id,sequence),
 foreign key(family_id,player_id,session_id) references scrabble.gym_sessions(family_id,player_id,id)
);
alter table scrabble.gym_sessions enable row level security;
alter table scrabble.gym_events enable row level security;
revoke all on scrabble.gym_sessions,scrabble.gym_events from public,anon,authenticated;
grant select,insert on scrabble.gym_sessions,scrabble.gym_events to scrabble_runtime;
create policy gym_sessions_read on scrabble.gym_sessions for select to scrabble_runtime using(scrabble.owns_player(family_id,player_id));
create policy gym_sessions_insert on scrabble.gym_sessions for insert to scrabble_runtime with check(scrabble.owns_player(family_id,player_id) and actor_id=scrabble.actor_id());
create policy gym_events_read on scrabble.gym_events for select to scrabble_runtime using(scrabble.owns_player(family_id,player_id));
create policy gym_events_insert on scrabble.gym_events for insert to scrabble_runtime with check(scrabble.owns_player(family_id,player_id));
