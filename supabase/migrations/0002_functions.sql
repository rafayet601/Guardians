-- ============================================================================
-- Guardians — 0002_functions
-- Profile bootstrap, updated_at, gamification engine, and the secure
-- status-transition RPCs. Sensitive transitions go through SECURITY DEFINER
-- functions (not direct table writes) so the rules can't be bypassed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up.
-- A username is derived from metadata, the email, or the uid, and de-duped.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  base_username := lower(coalesce(
    new.raw_user_meta_data ->> 'username',
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'guardian'
  ));
  -- keep only safe characters
  base_username := regexp_replace(base_username, '[^a-z0-9_]', '', 'g');
  if char_length(base_username) < 3 then
    base_username := 'guardian';
  end if;
  base_username := left(base_username, 24);

  final_username := base_username;
  while exists (select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    final_username,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists sightings_set_updated_at on public.sightings;
create trigger sightings_set_updated_at
  before update on public.sightings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gamification: level curve + badge awarding + points ledger
-- ---------------------------------------------------------------------------

-- Escalating curve: each level costs progressively more points.
--   lvl1=0, lvl2=50, lvl3=200, lvl4=450, lvl5=800, ...
create or replace function public.level_for_points(p_points integer)
returns integer
language sql
immutable
as $$
  select greatest(1, floor(sqrt(greatest(p_points, 0)::numeric / 50))::int + 1);
$$;

-- Awards (or re-checks) every badge the user now qualifies for.
create or replace function public.award_badges(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return; end if;

  insert into public.user_badges (user_id, badge_id)
  select p_user, b.id from (values
    ('first_report',   p.reports_count   >= 1),
    ('reporter_pro',   p.reports_count   >= 10),
    ('first_rescue',   p.rescues_count   >= 1),
    ('rescue_hero',    p.rescues_count   >= 5),
    ('guardian_angel', p.rescues_count   >= 25),
    ('matchmaker',     p.adoptions_count >= 1),
    ('community_star', p.points          >= 500),
    ('legend',         p.points          >= 2000)
  ) as b(id, earned)
  where b.earned
  on conflict (user_id, badge_id) do nothing;
end;
$$;

-- Adds points, recomputes the level, logs the event, and re-checks badges.
create or replace function public.award_points(
  p_user uuid, p_amount integer, p_reason text, p_sighting uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_amount is null then return; end if;

  update public.profiles
  set points = points + p_amount,
      level  = public.level_for_points(points + p_amount)
  where id = p_user;

  insert into public.point_events (user_id, amount, reason, sighting_id)
  values (p_user, p_amount, p_reason, p_sighting);

  perform public.award_badges(p_user);
end;
$$;

-- New sighting -> reporter earns points + a report tally.
create or replace function public.on_sighting_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reporter_id is not null then
    update public.profiles
    set reports_count = reports_count + 1
    where id = new.reporter_id;

    perform public.award_points(new.reporter_id, 10, 'Reported a cat', new.id);

    insert into public.sighting_updates (sighting_id, author_id, type, new_status, body)
    values (new.id, new.reporter_id, 'system', new.status, 'Sighting reported');
  end if;
  return new;
end;
$$;

drop trigger if exists sightings_on_created on public.sightings;
create trigger sightings_on_created
  after insert on public.sightings
  for each row execute function public.on_sighting_created();

-- ---------------------------------------------------------------------------
-- Transition rules
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_transition(p_old cat_status, p_new cat_status)
returns boolean
language sql
immutable
as $$
  select case
    when p_old = p_new then false
    -- anything still open can be archived
    when p_new = 'archived' and p_old <> 'adopted' then true
    when p_old = 'claimed'   and p_new in ('in_rescue', 'spotted') then true
    when p_old = 'in_rescue' and p_new in ('safe', 'claimed')      then true
    when p_old = 'safe'      and p_new in ('available', 'in_rescue') then true
    when p_old = 'available' and p_new = 'safe'                     then true
    else false
  end;
$$;

-- Create a sighting from lat/lng, building the PostGIS point server-side so the
-- client never has to serialize geography. reporter_id is forced to the caller.
create or replace function public.create_sighting(
  p_lat               double precision,
  p_lng               double precision,
  p_title             text default null,
  p_description       text default null,
  p_temperament       cat_temperament default 'unknown',
  p_color             text default null,
  p_is_injured        boolean default false,
  p_needs_urgent_help boolean default false,
  p_address           text default null
)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  s public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates';
  end if;

  insert into public.sightings (
    reporter_id, title, description, location, address,
    temperament, color, is_injured, needs_urgent_help
  )
  values (
    uid, nullif(trim(p_title), ''), nullif(trim(p_description), ''),
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    nullif(trim(p_address), ''),
    coalesce(p_temperament, 'unknown'), nullif(trim(p_color), ''),
    coalesce(p_is_injured, false), coalesce(p_needs_urgent_help, false)
  )
  returning * into s;

  return s;
end;
$$;

-- A guardian claims an open sighting.
create or replace function public.claim_sighting(p_sighting uuid)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  s public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting for update;
  if not found then raise exception 'Sighting not found'; end if;
  if s.status <> 'spotted' then
    raise exception 'This cat is no longer available to claim';
  end if;

  update public.sightings
  set status = 'claimed', claimed_by = uid, claimed_at = now()
  where id = p_sighting
  returning * into s;

  -- claiming a rescue makes you a guardian
  update public.profiles set is_guardian = true where id = uid and is_guardian = false;

  insert into public.sighting_updates (sighting_id, author_id, type, old_status, new_status, body)
  values (p_sighting, uid, 'claim', 'spotted', 'claimed', 'A guardian is on the way!');

  perform public.award_points(uid, 15, 'Claimed a rescue', p_sighting);
  return s;
end;
$$;

-- Advance a sighting along its lifecycle (reporter or assigned guardian only).
create or replace function public.update_sighting_status(
  p_sighting uuid, p_new_status cat_status, p_note text default null
)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  s public.sightings;
  v_old cat_status;
  v_claimed_by uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting for update;
  if not found then raise exception 'Sighting not found'; end if;

  if uid <> coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     and uid <> coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'Only the reporter or the assigned guardian can update this cat';
  end if;

  if p_new_status in ('claimed', 'adopted') then
    raise exception 'Use the dedicated action for that status';
  end if;

  if not public.is_valid_transition(s.status, p_new_status) then
    raise exception 'Cannot move from % to %', s.status, p_new_status;
  end if;

  -- capture pre-update values before RETURNING overwrites them
  v_old := s.status;
  v_claimed_by := s.claimed_by;

  update public.sightings
  set status = p_new_status,
      -- releasing a cat back to 'spotted' clears the previous guardian so
      -- they don't retain stale ownership/permissions
      claimed_by = case when p_new_status = 'spotted' then null else claimed_by end,
      claimed_at = case when p_new_status = 'spotted' then null else claimed_at end,
      rescued_at = case when p_new_status = 'safe' and rescued_at is null
                        then now() else rescued_at end
  where id = p_sighting
  returning * into s;

  insert into public.sighting_updates (sighting_id, author_id, type, old_status, new_status, body)
  values (p_sighting, uid, 'status_change', v_old, p_new_status, p_note);

  -- Rescue completed: reward the guardian who saw it through.
  if p_new_status = 'safe' and v_claimed_by is not null then
    update public.profiles set rescues_count = rescues_count + 1 where id = v_claimed_by;
    perform public.award_points(v_claimed_by, 50, 'Completed a rescue', p_sighting);
  end if;

  return s;
end;
$$;

-- An adopter expresses interest in an available cat.
create or replace function public.express_adoption_interest(
  p_sighting uuid, p_message text default null
)
returns public.adoption_interest
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  s public.sightings;
  ai public.adoption_interest;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting;
  if not found then raise exception 'Sighting not found'; end if;
  if s.status <> 'available' then
    raise exception 'This cat is not currently available for adoption';
  end if;
  if uid = coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     or uid = coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'You cannot adopt a cat you are managing';
  end if;

  insert into public.adoption_interest (sighting_id, user_id, message)
  values (p_sighting, uid, p_message)
  on conflict (sighting_id, user_id)
  do update set message = excluded.message, status = 'pending'
  returning * into ai;

  update public.profiles set wants_to_adopt = true where id = uid and wants_to_adopt = false;
  return ai;
end;
$$;

-- The lister approves an adopter -> the cat finds a forever home. 🎉
create or replace function public.approve_adoption(p_interest uuid)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  ai public.adoption_interest;
  s public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into ai from public.adoption_interest where id = p_interest;
  if not found then raise exception 'Adoption interest not found'; end if;

  select * into s from public.sightings where id = ai.sighting_id for update;
  if not found then raise exception 'Sighting not found'; end if;

  if uid <> coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     and uid <> coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'Only the reporter or the assigned guardian can approve an adoption';
  end if;
  if s.status <> 'available' then
    raise exception 'This cat is not available for adoption';
  end if;
  if ai.user_id = uid then
    raise exception 'You cannot approve your own adoption interest';
  end if;

  update public.adoption_interest set status = 'approved' where id = p_interest;
  update public.adoption_interest
  set status = 'declined' where sighting_id = ai.sighting_id and id <> p_interest and status = 'pending';

  update public.sightings set status = 'adopted' where id = ai.sighting_id returning * into s;

  insert into public.sighting_updates (sighting_id, author_id, type, old_status, new_status, body)
  values (ai.sighting_id, uid, 'status_change', 'available', 'adopted', 'Found a forever home!');

  -- adopter gets the warm fuzzy; the lister gets matchmaker credit
  perform public.award_points(ai.user_id, 25, 'Adopted a cat', ai.sighting_id);
  update public.profiles set adoptions_count = adoptions_count + 1 where id = uid;
  perform public.award_points(uid, 30, 'Placed a cat in a forever home', ai.sighting_id);

  return s;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least-privilege EXECUTE: these RPCs guard on auth.uid() internally, but we
-- also remove the implicit PUBLIC (anon) grant and pin it to authenticated.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_sighting(
  double precision, double precision, text, text, cat_temperament, text, boolean, boolean, text
) from public;
grant execute on function public.create_sighting(
  double precision, double precision, text, text, cat_temperament, text, boolean, boolean, text
) to authenticated;

revoke execute on function public.claim_sighting(uuid) from public;
grant  execute on function public.claim_sighting(uuid) to authenticated;

revoke execute on function public.update_sighting_status(uuid, cat_status, text) from public;
grant  execute on function public.update_sighting_status(uuid, cat_status, text) to authenticated;

revoke execute on function public.express_adoption_interest(uuid, text) from public;
grant  execute on function public.express_adoption_interest(uuid, text) to authenticated;

revoke execute on function public.approve_adoption(uuid) from public;
grant  execute on function public.approve_adoption(uuid) to authenticated;
