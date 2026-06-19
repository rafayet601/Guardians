-- ============================================================================
-- Guardians — 0009_location_privacy
-- Closes a privacy leak: previously any authenticated user could read a
-- sighting's EXACT coordinates (the generated lat/lng columns) via a direct
-- table select, and the detail screen plotted an exact pin for everyone.
--
-- Fix: detail reads now go through this SECURITY DEFINER RPC, which returns
-- precise coordinates (and the street address) ONLY to the reporter or the
-- assigned guardian. Everyone else gets coordinates rounded to ~3 decimals
-- (~110m), matching the coarsening already used by nearby_sightings()
-- (0003_geo.sql), plus an `is_precise` flag so the UI can show an approximate
-- area instead of a false-precision pin. The client-facing table selects stop
-- exposing lat/lng at all (see src/api/sightings.ts).
-- ============================================================================

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

  -- Precise location is shared only with the people coordinating the rescue.
  v_precise :=
    uid = coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
    or uid = coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000');

  if v_precise then
    v_lat := s.lat;
    v_lng := s.lng;
  else
    v_lat := round(s.lat::numeric, 3)::double precision;
    v_lng := round(s.lng::numeric, 3)::double precision;
  end if;

  result := jsonb_build_object(
    'id',                s.id,
    'reporter_id',       s.reporter_id,
    'title',             s.title,
    'description',       s.description,
    -- a free-text address can pinpoint the cat just like coordinates can
    'address',           case when v_precise then s.address else null end,
    'status',            s.status,
    'temperament',       s.temperament,
    'color',             s.color,
    'is_injured',        s.is_injured,
    'needs_urgent_help', s.needs_urgent_help,
    'claimed_by',        s.claimed_by,
    'claimed_at',        s.claimed_at,
    'rescued_at',        s.rescued_at,
    'created_at',        s.created_at,
    'updated_at',        s.updated_at,
    'lat',               v_lat,
    'lng',               v_lng,
    'is_precise',        v_precise,
    'reporter', (
      select jsonb_build_object('id', p.id, 'username', p.username,
                                'avatar_url', p.avatar_url, 'level', p.level)
      from public.profiles p where p.id = s.reporter_id
    ),
    'claimer', (
      select jsonb_build_object('id', p.id, 'username', p.username,
                                'avatar_url', p.avatar_url, 'level', p.level)
      from public.profiles p where p.id = s.claimed_by
    ),
    'photos', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', ph.id, 'sighting_id', ph.sighting_id, 'url', ph.url,
                           'uploaded_by', ph.uploaded_by, 'created_at', ph.created_at)
        order by ph.created_at
      )
      from public.sighting_photos ph where ph.sighting_id = s.id
    ), '[]'::jsonb)
  );

  return result;
end;
$$;

revoke execute on function public.get_sighting_detail(uuid) from public;
grant  execute on function public.get_sighting_detail(uuid) to authenticated;
