-- ============================================================================
-- Guardians — 0027_advisor_reconciliation
--
-- Reconciles the LIVE database with the hardening this repo already intends.
-- Supabase's migration ledger records 0012/0014/0017 as applied, but a catalog
-- audit (2026-07-17) showed several of their objects were missing — schema
-- drift, most likely from a later re-run of an earlier base migration that
-- `create or replace`d / `drop policy`+`create policy`'d them back to their
-- pre-hardening form.
--
-- WHAT WAS ACTUALLY BROKEN (verified against pg_catalog + a live RPC call):
--
--   [P0] `nearby_sightings` was SECURITY INVOKER on live. 0011 revoked the raw
--        lat/lng/location columns from `authenticated` and compensated by making
--        this function SECURITY DEFINER — the revoke landed, the DEFINER did
--        not. Result: every signed-in user calling the map RPC got
--        `42501 permission denied for table sightings`. THE LIVE MAP WAS DOWN.
--
--   [P1] Moderation read-path filtering from 0012 was missing: the SELECT
--        policies on sightings / sighting_updates were plain `using (true)`, so
--        `is_hidden` (auto-hide at 3 reports / moderator hide) had no effect on
--        direct table reads. 0 rows were hidden at the time of this migration,
--        so no content changes visibility today — this closes the bypass.
--
--   [P1] 0014's `set search_path` was missing on 3 functions.
--
--   [P2] 0017's `(select auth.uid())` initplan wrap was missing on 12 policies.
--
--   [P2] `analytics_events.user_id` FK had no covering index.
--
-- SAFETY: every statement is idempotent and logic-preserving.
--   * ALTER POLICY keeps roles/commands and never drops a policy, so there is
--     no window where a table sits unprotected.
--   * The (select auth.uid()) wrap is semantically identical — it only hoists
--     evaluation from per-row to per-query.
--   * nearby_sightings is restored to 0012's body (NOT 0011's): 0012 adds the
--     `is_hidden = false` filter. Using 0011's body here would silently
--     reintroduce a moderation bypass on the map now that it bypasses RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- [P0] nearby_sightings — restore SECURITY DEFINER (0012's authoritative body).
-- Reads lat/lng/location (revoked from `authenticated` by 0011), coarsens the
-- output to ~3 decimals (~110 m), clamps the radius, and excludes hidden rows.
-- Return shape is unchanged, so the client (src/api/sightings.ts getNearby)
-- needs no edit.
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

revoke execute on function public.nearby_sightings(
  double precision, double precision, double precision, cat_status[], integer
) from public, anon;
grant execute on function public.nearby_sightings(
  double precision, double precision, double precision, cat_status[], integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- [P1] Moderation read-path filtering (0012). Hidden content stays visible to
-- its own author and to moderators, so the moderation queue keeps working.
-- ---------------------------------------------------------------------------
alter policy "sightings are viewable by authenticated" on public.sightings
  using ((not is_hidden) or (reporter_id = (select auth.uid())) or public.is_moderator());

alter policy "updates are viewable by authenticated" on public.sighting_updates
  using ((not is_hidden) or (author_id = (select auth.uid())) or public.is_moderator());

-- ---------------------------------------------------------------------------
-- [P1] 0014: pin search_path on the 3 functions that drifted back to mutable.
-- ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.level_for_points(integer) set search_path = public, pg_temp;
alter function public.is_valid_transition(public.cat_status, public.cat_status)
  set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- [P2] 0017: hoist auth.uid() out of the per-row loop on the 12 policies that
-- drifted back to the bare call. Expressions are otherwise byte-identical to
-- what is live today.
-- ---------------------------------------------------------------------------
alter policy "interest visible to adopter and lister" on public.adoption_interest
  using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
     FROM sightings s
    WHERE ((s.id = adoption_interest.sighting_id)
      AND ((s.reporter_id = (select auth.uid())) OR (s.claimed_by = (select auth.uid()))))))));

alter policy "users withdraw their interest" on public.adoption_interest
  using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));

alter policy "owners manage their push tokens" on public.device_push_tokens
  using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));

alter policy "users read their own point events" on public.point_events
  using ((user_id = (select auth.uid())));

alter policy "users update their own profile" on public.profiles
  using ((id = (select auth.uid()))) with check ((id = (select auth.uid())));

alter policy "users add photos" on public.sighting_photos
  with check ((uploaded_by = (select auth.uid())));

alter policy "users delete their photos" on public.sighting_photos
  using ((uploaded_by = (select auth.uid())));

alter policy "users delete their comments" on public.sighting_updates
  using (((author_id = (select auth.uid())) AND (type = 'comment'::update_type)));

alter policy "users post comments" on public.sighting_updates
  with check (((author_id = (select auth.uid()))
    AND (type = 'comment'::update_type)
    AND (old_status IS NULL) AND (new_status IS NULL)));

alter policy "reporters delete their own sightings" on public.sightings
  using ((reporter_id = (select auth.uid())));

alter policy "reporters edit their own sightings" on public.sightings
  using ((reporter_id = (select auth.uid()))) with check ((reporter_id = (select auth.uid())));

alter policy "users create their own sightings" on public.sightings
  with check ((reporter_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- [P2] Covering index for the analytics_events FK (0015 convention).
-- ---------------------------------------------------------------------------
create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id);

-- ---------------------------------------------------------------------------
-- [P2] PostGIS `st_estimatedextent` is SECURITY DEFINER and reachable by anon
-- via /rest/v1/rpc. The app never calls it. Revoke where we are permitted to —
-- these are extension-owned, so a lack of ownership is not an error worth
-- aborting the migration for.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'st_estimatedextent'
  loop
    begin
      execute format('revoke execute on function %s from anon, authenticated', fn.sig);
    exception when insufficient_privilege or others then
      raise notice 'skipped revoke on % (not owner)', fn.sig;
    end;
  end loop;
end $$;
