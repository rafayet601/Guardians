-- ============================================================================
-- Guardians — 0012_moderation
-- Admin/moderator controls + trust & safety (roadmap A5). Adds a role hierarchy
-- (admins can appoint moderators), abuse reporting with community auto-hide,
-- user blocking, and moderator content takedown — with the read paths updated
-- so hidden/blocked content actually disappears for normal users.
--
-- Bootstrap the first admin manually (SQL editor), once:
--   update public.profiles set is_admin = true where username = 'YOUR_USERNAME';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles. is_admin already exists (0007). Add is_moderator. Neither is client-
-- writable (0004 column GRANTs restrict profile UPDATE to descriptive fields),
-- so roles can only change via grant_role() below. Admins are implicitly mods.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_moderator boolean not null default false;

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin or is_moderator from public.profiles where id = auth.uid()), false);
$$;

-- Admin-only: appoint/revoke moderators (and other admins).
create or replace function public.grant_role(p_user uuid, p_role text, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_user is null then raise exception 'User required'; end if;
  if p_role = 'moderator' then
    update public.profiles set is_moderator = coalesce(p_value, false) where id = p_user;
  elsif p_role = 'admin' then
    update public.profiles set is_admin = coalesce(p_value, false) where id = p_user;
  else
    raise exception 'Unknown role: %', p_role;
  end if;
end;
$$;
revoke execute on function public.grant_role(uuid, text, boolean) from public;
grant  execute on function public.grant_role(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Content-hide flags + abuse reports + blocks.
-- ---------------------------------------------------------------------------
alter table public.sightings        add column if not exists is_hidden boolean not null default false;
alter table public.sighting_updates add column if not exists is_hidden boolean not null default false;

create table if not exists public.abuse_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('sighting', 'comment', 'profile', 'photo')),
  target_id   uuid not null,
  reason      text,
  status      text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)  -- one report per user per target (also powers distinct-count auto-hide)
);
create index if not exists abuse_reports_target_idx on public.abuse_reports (target_type, target_id);
create index if not exists abuse_reports_status_idx on public.abuse_reports (status, created_at desc);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.abuse_reports enable row level security;
alter table public.user_blocks   enable row level security;

-- abuse_reports: a reporter sees their own; moderators see all. Inserts happen
-- only via report_content() (SECURITY DEFINER); status changes only via
-- moderate_content(). No direct INSERT/UPDATE policies = denied for clients.
drop policy if exists "reports visible to reporter or moderators" on public.abuse_reports;
create policy "reports visible to reporter or moderators"
  on public.abuse_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_moderator());

-- user_blocks: strictly owner-managed.
drop policy if exists "users manage their blocks" on public.user_blocks;
create policy "users manage their blocks"
  on public.user_blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- Rate-limit reports (reuses the generic trigger from 0011).
drop trigger if exists abuse_reports_rate on public.abuse_reports;
create trigger abuse_reports_rate before insert on public.abuse_reports
  for each row execute function public.enforce_insert_rate_limit('60 seconds', '10', 'reporter_id');

-- ---------------------------------------------------------------------------
-- Report content (any authenticated user). Auto-hides after 3 distinct reporters.
-- ---------------------------------------------------------------------------
create or replace function public.report_content(p_type text, p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid     uuid := auth.uid();
  v_count int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_type not in ('sighting', 'comment', 'profile', 'photo') then
    raise exception 'Invalid target type';
  end if;
  if p_id is null then raise exception 'Target required'; end if;

  insert into public.abuse_reports (reporter_id, target_type, target_id, reason)
  values (uid, p_type, p_id, nullif(trim(p_reason), ''))
  on conflict (reporter_id, target_type, target_id) do nothing;

  -- Community auto-hide: 3+ distinct reporters hides a sighting/comment pending review.
  select count(distinct reporter_id) into v_count
  from public.abuse_reports where target_type = p_type and target_id = p_id;
  if v_count >= 3 then
    if p_type = 'sighting' then
      update public.sightings set is_hidden = true where id = p_id;
    elsif p_type = 'comment' then
      update public.sighting_updates set is_hidden = true where id = p_id;
    end if;
  end if;
end;
$$;
revoke execute on function public.report_content(text, uuid, text) from public;
grant  execute on function public.report_content(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Moderate content (moderators/admins only): hide or restore, and resolve reports.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_content(p_type text, p_id uuid, p_hide boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator() then raise exception 'Moderators only'; end if;
  if p_type = 'sighting' then
    update public.sightings set is_hidden = coalesce(p_hide, true) where id = p_id;
  elsif p_type = 'comment' then
    update public.sighting_updates set is_hidden = coalesce(p_hide, true) where id = p_id;
  else
    raise exception 'Unsupported target type';
  end if;
  update public.abuse_reports
  set status = case when coalesce(p_hide, true) then 'actioned' else 'dismissed' end
  where target_type = p_type and target_id = p_id and status in ('open', 'reviewing');
end;
$$;
revoke execute on function public.moderate_content(text, uuid, boolean) from public;
grant  execute on function public.moderate_content(text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Read-path filtering: hidden rows disappear for everyone except the owner and
-- moderators; comments from users you've blocked disappear for you.
-- (RLS policy expressions may reference any column regardless of the column
--  GRANTs added in 0011.)
-- ---------------------------------------------------------------------------
drop policy if exists "sightings are viewable by authenticated" on public.sightings;
create policy "sightings are viewable by authenticated"
  on public.sightings for select to authenticated
  using (not is_hidden or reporter_id = auth.uid() or public.is_moderator());

drop policy if exists "updates are viewable by authenticated" on public.sighting_updates;
create policy "updates are viewable by authenticated"
  on public.sighting_updates for select to authenticated
  using (
    (not is_hidden or author_id = auth.uid() or public.is_moderator())
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = auth.uid() and b.blocked_id = author_id
    )
  );

-- The DEFINER read RPCs bypass RLS, so re-declare them to respect is_hidden.

-- nearby_sightings: re-declare 0011's version + exclude hidden from the map.
create or replace function public.nearby_sightings(
  p_lat double precision, p_lng double precision, p_radius_m double precision default 5000,
  p_statuses cat_status[] default null, p_limit integer default 200
)
returns table (
  id uuid, lat double precision, lng double precision, title text, status cat_status,
  temperament cat_temperament, color text, is_injured boolean, needs_urgent_help boolean,
  created_at timestamptz, distance_m double precision, reporter_id uuid,
  reporter_username text, thumbnail_url text
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates';
  end if;
  return query
  with origin as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g)
  select
    s.id,
    round(s.lat::numeric, 3)::double precision,
    round(s.lng::numeric, 3)::double precision,
    s.title, s.status, s.temperament, s.color, s.is_injured, s.needs_urgent_help,
    s.created_at, st_distance(s.location, o.g), s.reporter_id, p.username,
    (select ph.url from public.sighting_photos ph
       where ph.sighting_id = s.id order by ph.created_at asc limit 1)
  from public.sightings s
  cross join origin o
  left join public.profiles p on p.id = s.reporter_id
  where st_dwithin(s.location, o.g, least(coalesce(p_radius_m, 5000), 20000))
    and s.status <> 'archived'
    and s.is_hidden = false
    and (p_statuses is null or s.status = any (p_statuses))
  order by s.location <-> o.g
  limit greatest(1, least(p_limit, 500));
end;
$$;
revoke execute on function public.nearby_sightings(double precision, double precision, double precision, cat_status[], integer) from public;
grant  execute on function public.nearby_sightings(double precision, double precision, double precision, cat_status[], integer) to authenticated;

-- get_sighting_detail: re-declare 0009's version + block access to hidden cats
-- (owner/guardian/moderator may still open them).
create or replace function public.get_sighting_detail(p_sighting uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  s         public.sightings;
  v_precise boolean;
  v_lat     double precision;
  v_lng     double precision;
  result    jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting;
  if not found then raise exception 'Sighting not found'; end if;

  v_precise :=
    uid = coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
    or uid = coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000');

  -- Hidden cats are visible only to the people managing them and moderators.
  if s.is_hidden and not v_precise and not public.is_moderator() then
    raise exception 'Sighting not found';
  end if;

  if v_precise then
    v_lat := s.lat; v_lng := s.lng;
  else
    v_lat := round(s.lat::numeric, 3)::double precision;
    v_lng := round(s.lng::numeric, 3)::double precision;
  end if;

  result := jsonb_build_object(
    'id', s.id, 'reporter_id', s.reporter_id, 'title', s.title, 'description', s.description,
    'address', case when v_precise then s.address else null end,
    'status', s.status, 'temperament', s.temperament, 'color', s.color,
    'is_injured', s.is_injured, 'needs_urgent_help', s.needs_urgent_help,
    'claimed_by', s.claimed_by, 'claimed_at', s.claimed_at, 'rescued_at', s.rescued_at,
    'created_at', s.created_at, 'updated_at', s.updated_at,
    'lat', v_lat, 'lng', v_lng, 'is_precise', v_precise,
    'reporter', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'level', p.level)
                 from public.profiles p where p.id = s.reporter_id),
    'claimer', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'level', p.level)
                from public.profiles p where p.id = s.claimed_by),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'sighting_id', ph.sighting_id, 'url', ph.url,
                                'uploaded_by', ph.uploaded_by, 'created_at', ph.created_at) order by ph.created_at)
               from public.sighting_photos ph where ph.sighting_id = s.id), '[]'::jsonb)
  );
  return result;
end;
$$;
revoke execute on function public.get_sighting_detail(uuid) from public;
grant  execute on function public.get_sighting_detail(uuid) to authenticated;
