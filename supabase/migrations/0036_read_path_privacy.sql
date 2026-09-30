-- 0036 — read-path privacy: honour blocks, and stop nearby_sightings leaking
-- precise locations through its distance.
--
-- NOT APPLIED to any hosted project by this file being here. Apply it the way
-- the migration headers in DEPLOY.md describe, after reading it. It is
-- independent of the app: the client already hides blocked users' reports itself
-- (src/lib/blocking.ts), so nothing breaks whether or not this is applied, and
-- applying it makes the server enforce what the client only displays.
--
-- ── 1. Blocking did not actually hide anything on the server ────────────────
-- The block dialog promises "You won't see their reports anymore" (and Apple's
-- UGC guideline expects blocking to work). But:
--   * `sightings` SELECT policy only checks is_hidden — never user_blocks;
--   * `nearby_sightings` (0027) filters archived + hidden only;
--   * the comment policy DID filter blocked authors (0012, restated by 0017),
--     but 0027's `alter policy` reset it to the hidden-only expression, so
--     blocked users' comments came back. Nothing tested it.
-- This restores the comment filter and applies the same rule to reports.
-- Moderators are exempt on `sightings` so the moderation queue keeps working.
--
-- ── 2. nearby_sightings let anyone trilaterate a precise location ───────────
-- Its output coordinates are rounded to ~110 m (the coarsening invariant that
-- get_sighting_detail enforces and location_privacy_test guards), but the
-- distance it returned, the radius it filtered on and the order it sorted by
-- all used the PRECISE point. Any signed-in user can choose the search origin,
-- so three calls give three exact distances to one cat, which is enough to
-- solve for its exact position; a binary search on the radius does the same.
-- Distance, radius and ordering now use the coarsened point, so what can be
-- learned equals what the rounded coordinates already reveal. A precise
-- index-assisted prefilter (radius + 150 m, larger than the worst-case rounding
-- error of ~80 m) keeps the GiST index in play without changing the result:
-- the final filter is on the coarse distance.

-- ---------------------------------------------------------------------------
-- 1a. Comments: blocked authors are hidden from the blocker (restores 0012/0017)
-- ---------------------------------------------------------------------------
alter policy "updates are viewable by authenticated" on public.sighting_updates
  using (
    ((not is_hidden) or (author_id = (select auth.uid())) or public.is_moderator())
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = (select auth.uid())
        and b.blocked_id = sighting_updates.author_id
    )
  );

-- ---------------------------------------------------------------------------
-- 1b. Reports: blocked reporters are hidden from the blocker (moderators exempt)
-- ---------------------------------------------------------------------------
alter policy "sightings are viewable by authenticated" on public.sightings
  using (
    ((not is_hidden) or (reporter_id = (select auth.uid())) or public.is_moderator())
    and (
      public.is_moderator()
      or not exists (
        select 1 from public.user_blocks b
        where b.blocker_id = (select auth.uid())
          and b.blocked_id = sightings.reporter_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 1c + 2. nearby_sightings: skip blocked reporters; measure to the coarse point
-- Same signature and return shape as 0027, so the client needs no change.
-- ---------------------------------------------------------------------------
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
declare
  v_uid uuid := auth.uid();
  v_radius double precision := least(coalesce(p_radius_m, 5000), 20000);
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates';
  end if;
  return query
  with origin as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g),
  candidates as (
    select
      s.id as c_id,
      round(s.lat::numeric, 3)::double precision as c_lat,
      round(s.lng::numeric, 3)::double precision as c_lng,
      s.title as c_title, s.status as c_status, s.temperament as c_temperament,
      s.color as c_color, s.is_injured as c_is_injured,
      s.needs_urgent_help as c_needs_urgent_help, s.created_at as c_created_at,
      s.reporter_id as c_reporter_id,
      st_setsrid(
        st_makepoint(round(s.lng::numeric, 3)::double precision,
                     round(s.lat::numeric, 3)::double precision), 4326
      )::geography as c_coarse
    from public.sightings s
    cross join origin o
    -- Index-assisted prefilter on the precise point. The margin exceeds the
    -- worst-case rounding error, so it never drops a row the coarse filter
    -- below would keep, and it reveals nothing the coarse filter does not.
    where st_dwithin(s.location, o.g, v_radius + 150)
      and s.status <> 'archived'
      and s.is_hidden = false
      and (p_statuses is null or s.status = any (p_statuses))
      and not exists (
        select 1 from public.user_blocks b
        where b.blocker_id = v_uid and b.blocked_id = s.reporter_id
      )
  )
  select
    c.c_id, c.c_lat, c.c_lng, c.c_title, c.c_status, c.c_temperament, c.c_color,
    c.c_is_injured, c.c_needs_urgent_help, c.c_created_at,
    st_distance(c.c_coarse, o.g),
    c.c_reporter_id, p.username,
    (select ph.url from public.sighting_photos ph
       where ph.sighting_id = c.c_id order by ph.created_at asc limit 1)
  from candidates c
  cross join origin o
  left join public.profiles p on p.id = c.c_reporter_id
  where st_dwithin(c.c_coarse, o.g, v_radius)
  order by c.c_coarse <-> o.g
  limit greatest(1, least(p_limit, 500));
end;
$$;

-- create or replace keeps the existing ACL; restated so the intent is explicit.
revoke execute on function public.nearby_sightings(
  double precision, double precision, double precision, cat_status[], integer
) from public, anon;
grant execute on function public.nearby_sightings(
  double precision, double precision, double precision, cat_status[], integer
) to authenticated;
