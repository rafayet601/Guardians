-- ============================================================================
-- Guardians — 0010_push_geo
-- Turns the scaffolded `device_push_tokens` table into a geo-targeted push
-- system. Each device stores a COARSE "home area" (rounded ~110m, never a
-- precise point) plus notification preferences. `upsert_push_token` is the
-- only client-facing write (coarsens server-side); `tokens_near` is callable
-- ONLY by the service role (the send-push Edge Function) so push tokens are
-- never readable by clients.
-- ============================================================================

alter table public.device_push_tokens
  add column if not exists last_known_location geography(Point, 4326);
alter table public.device_push_tokens
  add column if not exists notify_radius_m integer not null default 8000;
alter table public.device_push_tokens
  add column if not exists urgent_opt_in boolean not null default true;

create index if not exists device_push_tokens_loc_gix
  on public.device_push_tokens using gist (last_known_location);

-- ---------------------------------------------------------------------------
-- Client-facing: register/refresh this device's token + coarse home area.
-- Coordinates are rounded to ~110m before storage so we never persist a
-- precise home location.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_push_token(
  p_token text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  geo geography(Point, 4326);
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_token is null or length(p_token) < 10 then raise exception 'Invalid push token'; end if;

  if p_lat is not null and p_lng is not null then
    geo := st_setsrid(
      st_makepoint(round(p_lng::numeric, 3)::double precision,
                   round(p_lat::numeric, 3)::double precision),
      4326
    )::geography;
  end if;

  insert into public.device_push_tokens (user_id, token, last_known_location, updated_at)
  values (uid, p_token, geo, now())
  on conflict (user_id, token) do update
    set last_known_location = coalesce(excluded.last_known_location, public.device_push_tokens.last_known_location),
        updated_at = now();
end;
$$;

revoke execute on function public.upsert_push_token(text, double precision, double precision) from public;
grant  execute on function public.upsert_push_token(text, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role only: tokens of opted-in users whose home area is within
-- p_radius_m of a point, excluding one user (the reporter). Returns just the
-- Expo push tokens — never coordinates. NOT granted to anon/authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.tokens_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 8000,
  p_exclude_user uuid default null
)
returns table (token text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select t.token
  from public.device_push_tokens t
  where t.urgent_opt_in
    and t.last_known_location is not null
    and (p_exclude_user is null or t.user_id <> p_exclude_user)
    and st_dwithin(
      t.last_known_location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      least(p_radius_m, t.notify_radius_m)
    );
$$;

revoke execute on function public.tokens_near(double precision, double precision, integer, uuid) from public, anon, authenticated;
grant  execute on function public.tokens_near(double precision, double precision, integer, uuid) to service_role;
