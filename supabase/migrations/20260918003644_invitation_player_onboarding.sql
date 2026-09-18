-- Additive: existing links and historical player identities are preserved.
begin;
alter table scrabble.invitations add column player_id text,
  add foreign key (family_id,player_id) references scrabble.players(family_id,id);
create unique index invitation_reserved_player on scrabble.invitations(family_id,player_id) where active and player_id is not null;
alter table scrabble.memberships add column profile_setup_pending boolean not null default false;

create or replace function scrabble.admit_member() returns boolean
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
  if invite.player_id is not null and exists(select 1 from scrabble.memberships where family_id=scrabble.family_id() and player_id=invite.player_id) then return false; end if;
  insert into scrabble.memberships(family_id,user_id,email,role,player_id,profile_setup_pending)
    values(scrabble.family_id(),scrabble.actor_id(),email_claim,'member',invite.player_id,true);
  update scrabble.invitations set accepted_by=scrabble.actor_id(),active=false,revision=revision+1
    where family_id=scrabble.family_id() and email=email_claim;
  insert into scrabble.audit(family_id,id,actor_id,action,subject,after_value)
    values(scrabble.family_id(),gen_random_uuid(),scrabble.actor_id(),'member.admitted',scrabble.actor_id()::text,
      jsonb_build_object('email',email_claim,'role','member','playerId',invite.player_id));
  return true;
end $$;

-- Narrow exception to normal profile permissions: a member can complete only their
-- own initial profile. Never accepts an arbitrary existing player to claim.
create function scrabble.complete_player_profile(new_id text, member_revision integer, player_revision integer, profile jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare who scrabble.memberships; before_profile scrabble.players; target text;
begin
  if scrabble.actor_id() is null or scrabble.family_id() is null or current_setting('scrabble.email_verified',true) is distinct from 'true' then
    raise exception 'Verified identity required' using errcode='42501';
  end if;
  perform 1 from scrabble.families where id=scrabble.family_id() for update;
  select * into who from scrabble.memberships where family_id=scrabble.family_id() and user_id=scrabble.actor_id() for update;
  if not found or not who.active or not who.profile_setup_pending then
    raise exception 'Initial profile setup is unavailable' using errcode='42501';
  end if;
  if member_revision is distinct from who.revision then raise exception 'Account changed' using errcode='40001'; end if;
  if jsonb_typeof(profile) is distinct from 'object' or jsonb_typeof(profile->'name') is distinct from 'string'
    or length(btrim(profile->>'name')) not between 1 and 60 or length(coalesce(profile->>'nickname',''))>60
    or length(coalesce(profile->>'bio',''))>240 or new_id is null or new_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' then
    raise exception 'Invalid profile' using errcode='22023';
  end if;
  target := coalesce(who.player_id,new_id);
  if target <> new_id then raise exception 'Invitation profile mismatch' using errcode='42501'; end if;
  if who.player_id is null then
    if player_revision is not null then raise exception 'New profile revision invalid' using errcode='22023'; end if;
    insert into scrabble.players(family_id,id,name,nickname,bio,photo_data_url)
      values(who.family_id,target,profile->>'name',nullif(profile->>'nickname',''),coalesce(profile->>'bio',''),profile->>'photoDataUrl');
  else
    select * into before_profile from scrabble.players where family_id=who.family_id and id=target for update;
    if not found or player_revision is distinct from before_profile.revision then raise exception 'Profile changed' using errcode='40001'; end if;
    update scrabble.players set name=profile->>'name',nickname=nullif(profile->>'nickname',''),bio=coalesce(profile->>'bio',''),photo_data_url=profile->>'photoDataUrl',revision=revision+1 where family_id=who.family_id and id=target;
  end if;
  update scrabble.memberships set player_id=target,profile_setup_pending=false,revision=revision+1 where family_id=who.family_id and user_id=who.user_id;
  insert into scrabble.audit(family_id,id,actor_id,action,subject,before_value,after_value)
    values(who.family_id,gen_random_uuid(),who.user_id,'member.profile-completed',target,
      to_jsonb(before_profile),jsonb_build_object('playerId',target,'profile',profile));
end $$;
revoke all on function scrabble.complete_player_profile(text,integer,integer,jsonb),scrabble.admit_member() from public,anon,authenticated,service_role;
grant execute on function scrabble.complete_player_profile(text,integer,integer,jsonb),scrabble.admit_member() to scrabble_runtime;
commit;
