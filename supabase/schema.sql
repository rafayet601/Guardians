-- ============================================================================
-- Guardians — combined schema (all migrations 0001-0008, in order).
-- Paste this whole file into the Supabase SQL Editor and Run, then optionally
-- run seed.sql. Generated from migrations/ — edit those, not this file.
-- ============================================================================


-- >>> migrations/0001_init.sql
-- ============================================================================
-- Guardians — 0001_init
-- Core schema: extensions, enums, tables, indexes.
-- ============================================================================

-- PostGIS powers "cats near me" radius queries.
create extension if not exists postgis;
-- gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Lifecycle of a reported cat:
--   spotted    -> just reported, awaiting a guardian
--   claimed    -> a guardian has committed to going to rescue it
--   in_rescue  -> guardian is actively rescuing / transporting
--   safe       -> rescued and in care (vet / foster)
--   available  -> ready to be adopted into a forever home
--   adopted    -> found a forever home  🎉
--   archived   -> closed (duplicate, false report, or cat left on its own)
do $$ begin
  create type cat_status as enum
    ('spotted', 'claimed', 'in_rescue', 'safe', 'available', 'adopted', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cat_temperament as enum ('friendly', 'shy', 'feral', 'unknown');
exception when duplicate_object then null; end $$;

-- Entries in a sighting's activity timeline.
do $$ begin
  create type update_type as enum ('comment', 'status_change', 'photo', 'claim', 'system');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  username       text unique not null,
  full_name      text,
  avatar_url     text,
  bio            text,
  is_guardian    boolean not null default false,   -- opted in to rescue duty
  wants_to_adopt boolean not null default false,
  points         integer not null default 0,
  level          integer not null default 1,
  reports_count  integer not null default 0,
  rescues_count  integer not null default 0,
  adoptions_count integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint username_length check (char_length(username) between 3 and 30)
);

-- ---------------------------------------------------------------------------
-- device_push_tokens  (Expo push tokens, kept private to each owner)
-- Stored separately from profiles so a public profile read can never leak a
-- device identifier. RLS (0004) restricts all access to the owner.
-- ---------------------------------------------------------------------------
create table if not exists public.device_push_tokens (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- ---------------------------------------------------------------------------
-- sightings  (the core unit: a reported cat)
-- ---------------------------------------------------------------------------
create table if not exists public.sightings (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid references public.profiles (id) on delete set null,
  title             text,
  description       text,
  location          geography(Point, 4326) not null,
  -- Convenience columns derived from `location` so the client can read
  -- coordinates without a spatial cast.
  lat               double precision generated always as (st_y(location::geometry)) stored,
  lng               double precision generated always as (st_x(location::geometry)) stored,
  address           text,
  status            cat_status not null default 'spotted',
  temperament       cat_temperament not null default 'unknown',
  color             text,
  is_injured        boolean not null default false,
  needs_urgent_help boolean not null default false,
  claimed_by        uuid references public.profiles (id) on delete set null,
  claimed_at        timestamptz,
  rescued_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists sightings_location_gix on public.sightings using gist (location);
create index if not exists sightings_status_idx   on public.sightings (status);
create index if not exists sightings_reporter_idx on public.sightings (reporter_id);
create index if not exists sightings_claimed_idx  on public.sightings (claimed_by);
create index if not exists sightings_created_idx  on public.sightings (created_at desc);

-- ---------------------------------------------------------------------------
-- sighting_photos
-- ---------------------------------------------------------------------------
create table if not exists public.sighting_photos (
  id          uuid primary key default gen_random_uuid(),
  sighting_id uuid not null references public.sightings (id) on delete cascade,
  url         text not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sighting_photos_sighting_idx on public.sighting_photos (sighting_id);

-- ---------------------------------------------------------------------------
-- sighting_updates  (community thread + status timeline)
-- ---------------------------------------------------------------------------
create table if not exists public.sighting_updates (
  id          uuid primary key default gen_random_uuid(),
  sighting_id uuid not null references public.sightings (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  type        update_type not null default 'comment',
  body        text,
  old_status  cat_status,
  new_status  cat_status,
  created_at  timestamptz not null default now()
);
create index if not exists sighting_updates_sighting_idx on public.sighting_updates (sighting_id, created_at);

-- ---------------------------------------------------------------------------
-- adoption_interest  (an adopter expresses interest in an available cat)
-- ---------------------------------------------------------------------------
create table if not exists public.adoption_interest (
  id          uuid primary key default gen_random_uuid(),
  sighting_id uuid not null references public.sightings (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  message     text,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  created_at  timestamptz not null default now(),
  unique (sighting_id, user_id)
);
create index if not exists adoption_interest_sighting_idx on public.adoption_interest (sighting_id);
create index if not exists adoption_interest_user_idx     on public.adoption_interest (user_id);

-- ---------------------------------------------------------------------------
-- Gamification: badges catalog, awarded badges, points ledger
-- ---------------------------------------------------------------------------
create table if not exists public.badges (
  id          text primary key,           -- slug, e.g. 'first_report'
  name        text not null,
  description text not null,
  icon        text not null,              -- emoji
  sort_order  integer not null default 0
);

create table if not exists public.user_badges (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  badge_id   text not null references public.badges (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create table if not exists public.point_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount      integer not null,
  reason      text not null,
  sighting_id uuid references public.sightings (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists point_events_user_idx on public.point_events (user_id, created_at desc);

-- >>> migrations/0002_functions.sql
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

-- >>> migrations/0003_geo.sql
-- ============================================================================
-- Guardians — 0003_geo
-- "Cats near me" radius search backed by the PostGIS GIST index.
-- Runs as SECURITY INVOKER (default) so row-level security still applies.
-- ============================================================================

create or replace function public.nearby_sightings(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  double precision default 5000,
  p_statuses  cat_status[] default null,
  p_limit     integer default 200
)
returns table (
  id                uuid,
  lat               double precision,
  lng               double precision,
  title             text,
  status            cat_status,
  temperament       cat_temperament,
  color             text,
  is_injured        boolean,
  needs_urgent_help boolean,
  created_at        timestamptz,
  distance_m        double precision,
  reporter_id       uuid,
  reporter_username text,
  thumbnail_url     text
)
language sql
stable
as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    s.id,
    -- Coarsen to ~3 decimals (~110m) so the map can't be used to enumerate the
    -- exact location of a cat (or, by proxy, the reporter's whereabouts).
    round(s.lat::numeric, 3)::double precision as lat,
    round(s.lng::numeric, 3)::double precision as lng,
    s.title,
    s.status,
    s.temperament,
    s.color,
    s.is_injured,
    s.needs_urgent_help,
    s.created_at,
    st_distance(s.location, o.g) as distance_m,
    s.reporter_id,
    p.username as reporter_username,
    (
      select ph.url from public.sighting_photos ph
      where ph.sighting_id = s.id
      order by ph.created_at asc
      limit 1
    ) as thumbnail_url
  from public.sightings s
  cross join origin o
  left join public.profiles p on p.id = s.reporter_id
  -- clamp the radius so a single call can't sweep the whole map
  where st_dwithin(s.location, o.g, least(coalesce(p_radius_m, 5000), 20000))
    and s.status <> 'archived'
    and (p_statuses is null or s.status = any (p_statuses))
  order by s.location <-> o.g
  limit greatest(1, least(p_limit, 500));
$$;

grant execute on function public.nearby_sightings(
  double precision, double precision, double precision, cat_status[], integer
) to authenticated;

-- >>> migrations/0004_rls.sql
-- ============================================================================
-- Guardians — 0004_rls
-- Row Level Security. Enabling RLS with no policy denies all access by default,
-- so every readable table gets an explicit SELECT policy.
--
-- Sensitive columns (points, level, status, counts) are protected with
-- COLUMN-LEVEL GRANTs: clients may only UPDATE descriptive fields directly.
-- Score/status mutations happen exclusively through the SECURITY DEFINER RPCs
-- in 0002_functions.sql, which run as the table owner and bypass RLS.
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.sightings         enable row level security;
alter table public.sighting_photos   enable row level security;
alter table public.sighting_updates  enable row level security;
alter table public.adoption_interest enable row level security;
alter table public.badges            enable row level security;
alter table public.user_badges       enable row level security;
alter table public.point_events      enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles are viewable by authenticated" on public.profiles;
create policy "profiles are viewable by authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Lock down the score columns: clients can only touch the editable fields.
revoke update on public.profiles from anon, authenticated;
grant  update (username, full_name, avatar_url, bio, is_guardian, wants_to_adopt)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- device_push_tokens  (strictly owner-only — never visible to other users)
-- ---------------------------------------------------------------------------
alter table public.device_push_tokens enable row level security;

drop policy if exists "owners manage their push tokens" on public.device_push_tokens;
create policy "owners manage their push tokens"
  on public.device_push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- sightings
-- ---------------------------------------------------------------------------
drop policy if exists "sightings are viewable by authenticated" on public.sightings;
create policy "sightings are viewable by authenticated"
  on public.sightings for select to authenticated using (true);

drop policy if exists "users create their own sightings" on public.sightings;
create policy "users create their own sightings"
  on public.sightings for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "reporters edit their own sightings" on public.sightings;
create policy "reporters edit their own sightings"
  on public.sightings for update to authenticated
  using (reporter_id = auth.uid()) with check (reporter_id = auth.uid());

drop policy if exists "reporters delete their own sightings" on public.sightings;
create policy "reporters delete their own sightings"
  on public.sightings for delete to authenticated
  using (reporter_id = auth.uid());

-- status / claim columns are only mutable via the transition RPCs
revoke update on public.sightings from anon, authenticated;
grant  update (title, description, color, temperament, is_injured, needs_urgent_help, address)
  on public.sightings to authenticated;

-- ---------------------------------------------------------------------------
-- sighting_photos
-- ---------------------------------------------------------------------------
drop policy if exists "photos are viewable by authenticated" on public.sighting_photos;
create policy "photos are viewable by authenticated"
  on public.sighting_photos for select to authenticated using (true);

drop policy if exists "users add photos" on public.sighting_photos;
create policy "users add photos"
  on public.sighting_photos for insert to authenticated
  with check (uploaded_by = auth.uid());

drop policy if exists "users delete their photos" on public.sighting_photos;
create policy "users delete their photos"
  on public.sighting_photos for delete to authenticated
  using (uploaded_by = auth.uid());

-- ---------------------------------------------------------------------------
-- sighting_updates  (only plain comments may be inserted directly;
-- status_change / claim / system rows come from the RPCs)
-- ---------------------------------------------------------------------------
drop policy if exists "updates are viewable by authenticated" on public.sighting_updates;
create policy "updates are viewable by authenticated"
  on public.sighting_updates for select to authenticated using (true);

drop policy if exists "users post comments" on public.sighting_updates;
create policy "users post comments"
  on public.sighting_updates for insert to authenticated
  with check (
    author_id = auth.uid()
    and type = 'comment'
    and old_status is null
    and new_status is null
  );

drop policy if exists "users delete their comments" on public.sighting_updates;
create policy "users delete their comments"
  on public.sighting_updates for delete to authenticated
  using (author_id = auth.uid() and type = 'comment');

-- ---------------------------------------------------------------------------
-- adoption_interest  (created/approved via RPC; users can read & withdraw)
-- ---------------------------------------------------------------------------
drop policy if exists "interest visible to adopter and lister" on public.adoption_interest;
create policy "interest visible to adopter and lister"
  on public.adoption_interest for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.sightings s
      where s.id = sighting_id
        and (s.reporter_id = auth.uid() or s.claimed_by = auth.uid())
    )
  );

drop policy if exists "users withdraw their interest" on public.adoption_interest;
create policy "users withdraw their interest"
  on public.adoption_interest for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- badges  (public reference data)
-- ---------------------------------------------------------------------------
drop policy if exists "badges are public" on public.badges;
create policy "badges are public"
  on public.badges for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- user_badges  (public achievements)
-- ---------------------------------------------------------------------------
drop policy if exists "user badges are viewable" on public.user_badges;
create policy "user badges are viewable"
  on public.user_badges for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- point_events  (private to the owner)
-- ---------------------------------------------------------------------------
drop policy if exists "users read their own point events" on public.point_events;
create policy "users read their own point events"
  on public.point_events for select to authenticated
  using (user_id = auth.uid());

-- >>> migrations/0005_storage.sql
-- ============================================================================
-- Guardians — 0005_storage
-- Public-read buckets for cat photos and avatars. Uploads are scoped to a
-- per-user folder ("{uid}/...") so users can only write under their own path.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('cat-photos', 'cat-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read ----------------------------------------------------------------
drop policy if exists "public read cat photos" on storage.objects;
create policy "public read cat photos"
  on storage.objects for select to public
  using (bucket_id = 'cat-photos');

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars"
  on storage.objects for select to public
  using (bucket_id = 'avatars');

-- Upload into your own folder -------------------------------------------------
drop policy if exists "users upload cat photos" on storage.objects;
create policy "users upload cat photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cat-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users upload avatars" on storage.objects;
create policy "users upload avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Manage your own files -------------------------------------------------------
drop policy if exists "users update own files" on storage.objects;
create policy "users update own files"
  on storage.objects for update to authenticated
  using (owner = auth.uid() and bucket_id in ('cat-photos', 'avatars'));

drop policy if exists "users delete own files" on storage.objects;
create policy "users delete own files"
  on storage.objects for delete to authenticated
  using (owner = auth.uid() and bucket_id in ('cat-photos', 'avatars'));

-- >>> migrations/0006_seed_badges.sql
-- ============================================================================
-- Guardians — 0006_seed_badges
-- Badge catalog (reference data). award_badges() in 0002 references these ids,
-- so this must be applied. Safe to re-run.
-- ============================================================================

insert into public.badges (id, name, description, icon, sort_order) values
  ('first_report',   'First Sighting',  'Reported your first cat.',                    '👀', 10),
  ('reporter_pro',   'Eagle Eye',       'Reported 10 cats.',                           '🔭', 20),
  ('first_rescue',   'First Rescue',    'Completed your first rescue.',                '🦸', 30),
  ('rescue_hero',    'Rescue Hero',     'Completed 5 rescues.',                        '🏅', 40),
  ('guardian_angel', 'Guardian Angel',  'Completed 25 rescues.',                       '😇', 50),
  ('matchmaker',     'Matchmaker',      'Placed a cat in a forever home.',             '💞', 60),
  ('community_star', 'Community Star',  'Earned 500 points.',                          '⭐', 70),
  ('legend',         'Guardian Legend', 'Earned 2000 points.',                         '👑', 80)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      sort_order = excluded.sort_order;

-- >>> migrations/0007_rewards.sql
-- ============================================================================
-- Guardians — 0007_rewards
-- Brand rewards marketplace + sponsored placements.
--
-- DUAL CURRENCY: `profiles.points` stays the lifetime reputation score that
-- drives the leaderboard, levels, and badges — it is NEVER spent. A second,
-- spendable balance ("Kibble") is minted 1:1 alongside points and is what users
-- redeem for brand discounts. Redeeming spends Kibble only; rank is untouched.
--
-- Like points/point_events, every Kibble movement is logged to an append-only
-- ledger (wallet_transactions) and the balance is mutated ONLY through
-- SECURITY DEFINER functions, so clients can never write it directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: spendable wallet + admin flag (catalog curation gate)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists kibble_balance integer not null default 0;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Backfill launch users so existing points already have spendable Kibble.
-- Guarded so re-running the migration can't double-credit anyone.
update public.profiles
set kibble_balance = points
where kibble_balance = 0 and points > 0;

-- ---------------------------------------------------------------------------
-- reward_brands  (pet-friendly partners — curated/seeded for now)
-- ---------------------------------------------------------------------------
create table if not exists public.reward_brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  blurb      text,
  logo_url   text,
  website    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reward_offers  (a redeemable discount/perk from a brand)
--   cost_kibble                 -> how much Kibble to redeem
--   min_level / required_badge  -> tier gating (the "rescuers get exclusive
--                                  perks" mechanic — gate offers behind badges
--                                  like 'rescue_hero' or a minimum level)
--   inventory (null = ∞)        -> caps total redemptions
--   once_per_user               -> each user may redeem at most once
-- ---------------------------------------------------------------------------
create table if not exists public.reward_offers (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.reward_brands (id) on delete cascade,
  title            text not null,
  description      text,
  image_url        text,
  discount_label   text,                      -- e.g. '20% off', 'Free sample'
  cost_kibble      integer not null check (cost_kibble >= 0),
  min_level        integer not null default 1,
  required_badge_id text references public.badges (id) on delete set null,
  inventory        integer,                   -- null = unlimited
  redeemed_count   integer not null default 0,
  once_per_user    boolean not null default true,
  starts_at        timestamptz,
  ends_at          timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists reward_offers_brand_idx  on public.reward_offers (brand_id);
create index if not exists reward_offers_active_idx on public.reward_offers (is_active);

-- ---------------------------------------------------------------------------
-- reward_redemptions  (a user spent Kibble on an offer -> issued a code)
-- ---------------------------------------------------------------------------
create table if not exists public.reward_redemptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  offer_id    uuid not null references public.reward_offers (id) on delete cascade,
  cost_kibble integer not null,              -- snapshot of what was paid
  code        text not null,                 -- the discount code issued
  status      text not null default 'active'
                check (status in ('active', 'used', 'expired')),
  redeemed_at timestamptz not null default now(),
  expires_at  timestamptz
);
create index if not exists reward_redemptions_user_idx  on public.reward_redemptions (user_id, redeemed_at desc);
create index if not exists reward_redemptions_offer_idx on public.reward_redemptions (offer_id);

-- ---------------------------------------------------------------------------
-- wallet_transactions  (append-only Kibble ledger, mirrors point_events)
--   amount: positive = earned, negative = spent
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  amount        integer not null,
  reason        text not null,
  kind          text not null default 'earn'
                  check (kind in ('earn', 'redeem', 'adjust')),
  redemption_id uuid references public.reward_redemptions (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- sponsored_placements  (direct-sold brand ad slots, curated for now)
-- ---------------------------------------------------------------------------
create table if not exists public.sponsored_placements (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid references public.reward_brands (id) on delete set null,
  slot       text not null check (slot in ('feed_card', 'rewards_banner')),
  title      text not null,
  body       text,
  image_url  text,
  cta_label  text,
  cta_url    text,
  priority   integer not null default 0,      -- higher shows first
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsored_placements_slot_idx on public.sponsored_placements (slot, is_active);

-- ---------------------------------------------------------------------------
-- keep updated_at fresh (reuses set_updated_at() from 0002)
-- ---------------------------------------------------------------------------
drop trigger if exists reward_brands_set_updated_at on public.reward_brands;
create trigger reward_brands_set_updated_at
  before update on public.reward_brands
  for each row execute function public.set_updated_at();

drop trigger if exists reward_offers_set_updated_at on public.reward_offers;
create trigger reward_offers_set_updated_at
  before update on public.reward_offers
  for each row execute function public.set_updated_at();

drop trigger if exists sponsored_placements_set_updated_at on public.sponsored_placements;
create trigger sponsored_placements_set_updated_at
  before update on public.sponsored_placements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- award_points(): now also mints spendable Kibble 1:1 and logs the ledger
-- entry. Re-declared in full (body identical to 0002 plus the two Kibble
-- lines) so every existing caller — report/claim/rescue/adopt/place — earns
-- Kibble with zero changes to those RPCs.
-- ---------------------------------------------------------------------------
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
  set points         = points + p_amount,
      level          = public.level_for_points(points + p_amount),
      kibble_balance = kibble_balance + p_amount
  where id = p_user;

  insert into public.point_events (user_id, amount, reason, sighting_id)
  values (p_user, p_amount, p_reason, p_sighting);

  insert into public.wallet_transactions (user_id, amount, reason, kind)
  values (p_user, p_amount, p_reason, 'earn');

  perform public.award_badges(p_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_reward(): the ONLY path that spends Kibble. Validates eligibility,
-- inventory, balance, and once-per-user, then atomically debits the wallet,
-- logs the ledger entry, bumps the offer counter, and issues a code.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_reward(p_offer uuid)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  o   public.reward_offers;
  p   public.profiles;
  r   public.reward_redemptions;
  v_code text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- Lock the offer row so concurrent redemptions can't oversell inventory.
  select * into o from public.reward_offers where id = p_offer for update;
  if not found then raise exception 'Reward not found'; end if;

  if not o.is_active then
    raise exception 'This reward is no longer available';
  end if;
  if o.starts_at is not null and now() < o.starts_at then
    raise exception 'This reward is not available yet';
  end if;
  if o.ends_at is not null and now() > o.ends_at then
    raise exception 'This reward has expired';
  end if;
  if o.inventory is not null and o.redeemed_count >= o.inventory then
    raise exception 'This reward is sold out';
  end if;

  select * into p from public.profiles where id = uid;
  if not found then raise exception 'Profile not found'; end if;

  if p.level < o.min_level then
    raise exception 'Reach level % to unlock this reward', o.min_level;
  end if;
  if o.required_badge_id is not null
     and not exists (
       select 1 from public.user_badges ub
       where ub.user_id = uid and ub.badge_id = o.required_badge_id
     ) then
    raise exception 'This reward is reserved for guardians who earned the % badge', o.required_badge_id;
  end if;
  if o.once_per_user and exists (
       select 1 from public.reward_redemptions rr
       where rr.user_id = uid and rr.offer_id = p_offer
     ) then
    raise exception 'You have already redeemed this reward';
  end if;
  if p.kibble_balance < o.cost_kibble then
    raise exception 'Not enough Kibble — you need % but have %', o.cost_kibble, p.kibble_balance;
  end if;

  -- Short, human-friendly, reasonably unique code.
  v_code := 'GUARD-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));

  -- Debit the wallet (never the leaderboard points).
  update public.profiles
  set kibble_balance = kibble_balance - o.cost_kibble
  where id = uid;

  update public.reward_offers
  set redeemed_count = redeemed_count + 1
  where id = p_offer;

  insert into public.reward_redemptions (user_id, offer_id, cost_kibble, code, expires_at)
  values (uid, p_offer, o.cost_kibble, v_code,
          case when o.ends_at is not null then o.ends_at else now() + interval '90 days' end)
  returning * into r;

  insert into public.wallet_transactions (user_id, amount, reason, kind, redemption_id)
  values (uid, -o.cost_kibble, 'Redeemed: ' || o.title, 'redeem', r.id);

  return r;
end;
$$;

-- ============================================================================
-- Row Level Security (mirrors the conventions in 0004_rls.sql)
-- ============================================================================
alter table public.reward_brands         enable row level security;
alter table public.reward_offers         enable row level security;
alter table public.reward_redemptions    enable row level security;
alter table public.wallet_transactions   enable row level security;
alter table public.sponsored_placements  enable row level security;

-- helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- reward_brands: anyone signed in reads active brands; only admins write.
drop policy if exists "active brands are viewable" on public.reward_brands;
create policy "active brands are viewable"
  on public.reward_brands for select to authenticated using (is_active);

drop policy if exists "admins manage brands" on public.reward_brands;
create policy "admins manage brands"
  on public.reward_brands for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- reward_offers: anyone signed in reads active offers; only admins write.
drop policy if exists "active offers are viewable" on public.reward_offers;
create policy "active offers are viewable"
  on public.reward_offers for select to authenticated using (is_active);

drop policy if exists "admins manage offers" on public.reward_offers;
create policy "admins manage offers"
  on public.reward_offers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- reward_redemptions: strictly owner-readable. Inserts happen only via the
-- redeem_reward() SECURITY DEFINER RPC (no client INSERT policy = denied).
drop policy if exists "users read their own redemptions" on public.reward_redemptions;
create policy "users read their own redemptions"
  on public.reward_redemptions for select to authenticated
  using (user_id = auth.uid());

-- wallet_transactions: strictly owner-readable (mutated only via RPCs).
drop policy if exists "users read their own wallet" on public.wallet_transactions;
create policy "users read their own wallet"
  on public.wallet_transactions for select to authenticated
  using (user_id = auth.uid());

-- sponsored_placements: anyone signed in reads active placements; admins write.
drop policy if exists "active placements are viewable" on public.sponsored_placements;
create policy "active placements are viewable"
  on public.sponsored_placements for select to authenticated using (is_active);

drop policy if exists "admins manage placements" on public.sponsored_placements;
create policy "admins manage placements"
  on public.sponsored_placements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Least-privilege EXECUTE on the redemption RPC.
-- ---------------------------------------------------------------------------
revoke execute on function public.redeem_reward(uuid) from public;
grant  execute on function public.redeem_reward(uuid) to authenticated;

-- >>> migrations/0008_seed_rewards.sql
-- ============================================================================
-- Guardians — 0008_seed_rewards
-- Demo brands, offers, and sponsored placements so the rewards marketplace is
-- populated on first run. Curated content (no brand self-serve portal yet).
-- Fixed UUIDs keep this idempotent / safe to re-run.
--
-- Offers intentionally span every gate type so the tiering is demoable:
--   • open        — no gate, low cost (anyone)
--   • rescuer     — required_badge_id = 'rescue_hero'
--   • adopter     — required_badge_id = 'matchmaker'
--   • high-tier   — min_level >= 5
-- ============================================================================

insert into public.reward_brands (id, name, blurb, website, is_active) values
  ('a0000000-0000-4000-a000-000000000001', 'Whisker & Co.', 'Premium grain-free food for rescued cats.', 'https://example.com/whisker', true),
  ('a0000000-0000-4000-a000-000000000002', 'PurrLitter',    'Clumping, low-dust litter that cats love.',  'https://example.com/purrlitter', true),
  ('a0000000-0000-4000-a000-000000000003', 'The Cat Cabin', 'Beds, toys & carriers for every guardian.',  'https://example.com/catcabin', true),
  ('a0000000-0000-4000-a000-000000000004', 'PawCare Vets',  'Affordable wellness checks & vaccinations.', 'https://example.com/pawcare', true)
on conflict (id) do update
  set name = excluded.name, blurb = excluded.blurb,
      website = excluded.website, is_active = excluded.is_active;

insert into public.reward_offers
  (id, brand_id, title, description, discount_label, cost_kibble, min_level, required_badge_id, inventory, once_per_user, is_active)
values
  -- Open to everyone — a cheap first taste of the marketplace.
  ('b0000000-0000-4000-b000-000000000001', 'a0000000-0000-4000-a000-000000000001',
   '10% off your first order', 'Save on any bag of Whisker & Co. food.', '10% off',
   150, 1, null, null, true, true),

  ('b0000000-0000-4000-b000-000000000002', 'a0000000-0000-4000-a000-000000000002',
   '15% off PurrLitter', 'Discount on any PurrLitter subscription box.', '15% off',
   200, 1, null, null, true, true),

  -- Rescuer-exclusive — gated behind the Rescue Hero badge (5 rescues).
  ('b0000000-0000-4000-b000-000000000003', 'a0000000-0000-4000-a000-000000000001',
   'Rescuer perk: 30% off premium food', 'Reserved for our Rescue Heroes. Thank you for saving lives.', '30% off',
   400, 1, 'rescue_hero', null, true, true),

  -- Adopter perk — gated behind the Matchmaker badge (placed a cat).
  ('b0000000-0000-4000-b000-000000000004', 'a0000000-0000-4000-a000-000000000003',
   'Adopter starter kit', 'Free bed + toy bundle for guardians who rehomed a cat.', 'Free bundle',
   300, 1, 'matchmaker', 100, true, true),

  -- High-tier — level gate, the aspirational reward.
  ('b0000000-0000-4000-b000-000000000005', 'a0000000-0000-4000-a000-000000000004',
   '25% off a wellness check', 'Unlocks at level 5. Keep your cats healthy for less.', '25% off',
   600, 5, null, null, true, true),

  ('b0000000-0000-4000-b000-000000000006', 'a0000000-0000-4000-a000-000000000003',
   'Free enamel pin', 'A little thank-you for every guardian.', 'Free gift',
   50, 1, null, 500, true, true)
on conflict (id) do update
  set brand_id = excluded.brand_id, title = excluded.title, description = excluded.description,
      discount_label = excluded.discount_label, cost_kibble = excluded.cost_kibble,
      min_level = excluded.min_level, required_badge_id = excluded.required_badge_id,
      inventory = excluded.inventory, once_per_user = excluded.once_per_user,
      is_active = excluded.is_active;

insert into public.sponsored_placements
  (id, brand_id, slot, title, body, cta_label, cta_url, priority, is_active)
values
  ('c0000000-0000-4000-c000-000000000001', 'a0000000-0000-4000-a000-000000000001',
   'feed_card', 'Whisker & Co. loves rescuers 🐟',
   'Quality food for the cats you save. Redeem your Kibble for a discount.',
   'Shop now', 'https://example.com/whisker', 10, true),

  ('c0000000-0000-4000-c000-000000000002', 'a0000000-0000-4000-a000-000000000003',
   'rewards_banner', 'The Cat Cabin — Partner of the Month',
   'Spend your hard-earned Kibble on beds, toys & carriers.',
   'Explore', 'https://example.com/catcabin', 10, true)
on conflict (id) do update
  set brand_id = excluded.brand_id, slot = excluded.slot, title = excluded.title,
      body = excluded.body, cta_label = excluded.cta_label, cta_url = excluded.cta_url,
      priority = excluded.priority, is_active = excluded.is_active;
