-- Saved physical sets. Games keep their own immutable definition snapshot.
begin;
create table scrabble.equipment (
  family_id uuid primary key references scrabble.families(id),
  equipment jsonb not null check (
    jsonb_typeof(equipment) = 'object'
    and equipment ?& array['revision','sets','defaultSetId']
    and jsonb_typeof(equipment->'revision') = 'number'
    and (equipment->>'revision')::numeric between 0 and 2147483646
    and trunc((equipment->>'revision')::numeric) = (equipment->>'revision')::numeric
    and jsonb_typeof(equipment->'sets') = 'array'
    and jsonb_array_length(equipment->'sets') <= 20
    and octet_length(equipment::text) <= 40000
  ),
  updated_by uuid not null,
  foreign key (family_id, updated_by) references scrabble.memberships(family_id, user_id)
);
alter table scrabble.equipment enable row level security;
revoke all on scrabble.equipment from public, anon, authenticated;
grant select, insert, update on scrabble.equipment to scrabble_runtime;
create policy member_read on scrabble.equipment for select to scrabble_runtime using (scrabble.is_member(family_id));
create policy member_insert on scrabble.equipment for insert to scrabble_runtime with check (scrabble.is_member(family_id) and updated_by=scrabble.actor_id());
create policy member_update on scrabble.equipment for update to scrabble_runtime using (scrabble.is_member(family_id)) with check (scrabble.is_member(family_id) and updated_by=scrabble.actor_id());
create trigger no_erasure before delete or truncate on scrabble.equipment for each statement execute function scrabble.prevent_erasure();
commit;
