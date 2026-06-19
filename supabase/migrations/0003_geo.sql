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
