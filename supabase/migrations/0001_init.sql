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
