-- ============================================================================
-- Guardians — 0023_sighting_links
-- AI-M3 #4 — Duplicate-sighting detection / cat re-identification. On a sighting
-- with a photo, the ai-reid edge function computes (or reuses) a photo embedding
-- and queries nearest neighbours in a COMBINED PostGIS geo + time + pgvector
-- cosine window, surfacing "this might be the same cat as [X]" candidates.
-- The reporter/guardian confirms or rejects a suggestion; links are reversible
-- (a confirmed link can later be rejected). NEVER auto-merge. NEVER delete the
-- original two records or the link row — confirmed/rejected only flips status.
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Every function pins search_path and follows
-- the 0014/0016/0019/0020/0021 convention: revoke public/anon, grant only to
-- the role that must call it. The `sighting_links` table has RLS with a
-- reporter/guardian-visible SELECT policy and NO client INSERT/UPDATE/DELETE
-- policy (writes go through the confirm/reject SECURITY DEFINER RPCs or the
-- service-role edge function), exactly like analytics_events (0018) and
-- embeddings (0019).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- sighting_links — one row per suggested/confirmed/rejected pair of sightings.
-- The unique-pair index (least, greatest) ensures the same pair of sightings
-- is never suggested twice, regardless of which side was the "target" when the
-- suggestion was created. status is one of suggested|confirmed|rejected and is
-- NEVER used to delete a row — reversibility means flipping the status, not
-- removing history.
-- ---------------------------------------------------------------------------
create table if not exists public.sighting_links (
  id                 uuid primary key default gen_random_uuid(),
  sighting_id        uuid not null references public.sightings (id) on delete cascade,
  linked_sighting_id uuid not null references public.sightings (id) on delete cascade,
  confidence         double precision not null default 0,
  status             text not null default 'suggested'
                       check (status in ('suggested', 'confirmed', 'rejected')),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint sighting_links_no_self check (sighting_id <> linked_sighting_id)
);

-- One row per unordered pair: (A,B) and (B,A) collapse to the same key.
create unique index if not exists sighting_links_pair_uniq
  on public.sighting_links (least(sighting_id, linked_sighting_id), greatest(sighting_id, linked_sighting_id));

create index if not exists sighting_links_sighting_idx on public.sighting_links (sighting_id);
create index if not exists sighting_links_linked_idx   on public.sighting_links (linked_sighting_id);
create index if not exists sighting_links_status_idx   on public.sighting_links (status);

-- updated_at maintenance (reuses the shared trigger fn from 0002).
drop trigger if exists sighting_links_set_updated_at on public.sighting_links;
create trigger sighting_links_set_updated_at
  before update on public.sighting_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: readable when the caller is the reporter or assigned guardian of
-- EITHER sighting in the link. No client INSERT/UPDATE/DELETE policy — writes
-- go through confirm_sighting_link / reject_sighting_link (SECURITY DEFINER,
-- below) or the service-role ai-reid edge function. Denied for clients by
-- default (RLS on, no permissive policy for those commands).
-- ---------------------------------------------------------------------------
alter table public.sighting_links enable row level security;

drop policy if exists "links visible to reporter/guardian" on public.sighting_links;
create policy "links visible to reporter/guardian"
  on public.sighting_links for select to authenticated
  using (
    exists (
      select 1 from public.sightings s
      where s.id = sighting_id
        and (s.reporter_id = auth.uid() or s.claimed_by = auth.uid())
    )
    or exists (
      select 1 from public.sightings s
      where s.id = linked_sighting_id
        and (s.reporter_id = auth.uid() or s.claimed_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- coarse_location — snap a point to 3 decimals (~110m), the same coarsening
-- nearby_sightings() / get_sighting_detail (0009) expose to non-owners. The
-- matching RPCs (here and in 0025) use coarsened endpoints for BOTH st_dwithin
-- and st_distance: an exact distance (or an exact radius-inclusion boundary)
-- measured from a caller-chosen point can be trilaterated back to the other
-- party's precise coordinates, so nothing derived from a location a caller
-- isn't allowed to see precisely may be computed from the precise value.
-- ---------------------------------------------------------------------------
create or replace function public.coarse_location(p geography)
returns geography
language sql
immutable
set search_path = public, pg_temp
as $$
  select st_setsrid(
    st_makepoint(
      round(st_x(p::geometry)::numeric, 3)::double precision,
      round(st_y(p::geometry)::numeric, 3)::double precision
    ),
    4326
  )::geography
$$;

revoke execute on function public.coarse_location(geography) from public, anon;
grant  execute on function public.coarse_location(geography) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- find_sighting_duplicates — the combined PostGIS geo + time + pgvector cosine
-- nearest-neighbour query that powers "this might be the same cat." Returns
-- PUBLIC fields only (title, thumbnail, status, created_at, distance_m) —
-- never the candidate's raw lat/lng. Distance and the radius filter are
-- computed from coarse_location() of BOTH endpoints (~110m snap): stored
-- locations are precise (0009 coarsens at read time only), and an exact
-- distance — or an exact st_dwithin boundary probed via p_radius_m — measured
-- from a caller-controlled point would let the caller trilaterate another
-- user's precise sighting coordinates.
--
-- SECURITY DEFINER so it can read the no-policy `embeddings` table (0019) and
-- bypass RLS on `sightings`/`sighting_links`. Stable (read-only). Granted to
-- `authenticated`, and the body enforces that the caller is the target
-- sighting's reporter or assigned guardian (same guard as the 0025 RPCs) —
-- this RPC is directly callable via PostgREST, so it must not rely on the
-- ai-reid edge function's ownership check.
--
-- Confidence = 1 - cosine_distance (0..1). The threshold is set at 0.82:
-- biased toward FEWER, higher-confidence suggestions because a confirmed
-- wrong link merges two different cats' records (a false positive the user
-- acted on), while a missed suggestion (false negative) just doesn't show.
-- 0.82 compensates for the noisiness of caption-then-embed — an ~80-word text
-- description loses visual detail a true multimodal embedding would preserve,
-- so the bar for "might be the same cat" must be high. Tunable here in one
-- place; the ai-embeddings-agent charter requires stating the number + why.
-- ---------------------------------------------------------------------------
create or replace function public.find_sighting_duplicates(
  p_sighting      uuid,
  p_radius_m      int default 2000,
  p_max_age_hours int default 168,
  p_limit         int default 5
)
returns table (
  linked_sighting_id uuid,
  title              text,
  thumbnail_url      text,
  status             text,
  created_at         timestamptz,
  distance_m         double precision,
  confidence         double precision,
  link_id            uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Confidence threshold (1 - cosine_distance). See function header for why 0.82.
  v_threshold double precision := 0.82;
  v_radius    double precision := greatest(100, least(coalesce(p_radius_m, 2000), 50000))::double precision;
  v_hours     int      := greatest(1, least(coalesce(p_max_age_hours, 168), 720));
  v_limit     int      := greatest(1, least(coalesce(p_limit, 5), 20));
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_sighting is null then raise exception 'Sighting required'; end if;

  -- Caller must be the target sighting's reporter or assigned guardian. The
  -- ai-reid edge function checks this too, but the RPC is directly callable.
  if not exists (
    select 1 from public.sightings s
    where s.id = p_sighting
      and (s.reporter_id = auth.uid() or s.claimed_by = auth.uid())
  ) then
    raise exception 'Only the reporter or assigned guardian can search duplicates for this sighting';
  end if;

  return query
  with target as (
    select s.location as precise_location,
           public.coarse_location(s.location) as location,
           e.embedding
    from public.sightings s
    join public.embeddings e
      on e.owner_type = 'sighting' and e.owner_id = s.id and e.kind = 'sighting_photo'
    where s.id = p_sighting
  )
  select
    s2.id,
    s2.title,
    (select ph.url from public.sighting_photos ph
       where ph.sighting_id = s2.id order by ph.created_at asc limit 1),
    s2.status::text,
    s2.created_at,
    st_distance(public.coarse_location(s2.location), t.location)::double precision,
    (1.0 - (e2.embedding <=> t.embedding))::double precision,
    sl.id
  from public.sightings s2
  join public.embeddings e2
    on e2.owner_type = 'sighting' and e2.owner_id = s2.id and e2.kind = 'sighting_photo'
  cross join target t
  left join public.sighting_links sl
    on sl.status = 'suggested'
    and (
      (sl.sighting_id = p_sighting and sl.linked_sighting_id = s2.id)
      or (sl.sighting_id = s2.id and sl.linked_sighting_id = p_sighting)
    )
  where s2.id <> p_sighting
    and s2.status <> 'archived'
    and s2.is_hidden = false
    -- Index-friendly pre-filter on the precise column (uses the GiST index),
    -- padded so it can never exclude a pair the coarse filter accepts (the two
    -- coarse endpoints move < ~160m combined) — the visible result therefore
    -- remains a function of coarse coordinates only.
    and st_dwithin(s2.location, t.precise_location, v_radius + 320)
    and st_dwithin(public.coarse_location(s2.location), t.location, v_radius)
    and s2.created_at > now() - make_interval(hours => v_hours)
    and (1.0 - (e2.embedding <=> t.embedding)) >= v_threshold
    and not exists (
      select 1 from public.sighting_links sl2
      where sl2.status in ('confirmed', 'rejected')
        and (
          (sl2.sighting_id = p_sighting and sl2.linked_sighting_id = s2.id)
          or (sl2.sighting_id = s2.id and sl2.linked_sighting_id = p_sighting)
        )
    )
  order by e2.embedding <=> t.embedding
  limit v_limit;
end;
$$;

revoke execute on function public.find_sighting_duplicates(uuid, int, int, int) from public, anon;
grant  execute on function public.find_sighting_duplicates(uuid, int, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_sighting_link — flip a link to 'confirmed'. The caller must be the
-- reporter or assigned guardian of the link's `sighting_id` (the target when the
-- suggestion was created). `created_by` records who made the decision. SECURITY
-- DEFINER so it can write past the no-policy RLS on sighting_links. Reversible:
-- a confirmed link can later be rejected via reject_sighting_link. Never deletes
-- the row. Returns the updated row.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_sighting_link(p_link uuid)
returns public.sighting_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sl public.sighting_links;
  s  public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_link is null then raise exception 'Link required'; end if;

  select * into sl from public.sighting_links where id = p_link;
  if not found then raise exception 'Link not found'; end if;

  -- Only the reporter or assigned guardian of sighting_id may act on this link.
  select * into s from public.sightings where id = sl.sighting_id;
  if not found then raise exception 'Sighting not found'; end if;
  if uid <> coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     and uid <> coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'Only the reporter or assigned guardian of this sighting can confirm the link';
  end if;

  update public.sighting_links
    set status = 'confirmed', created_by = uid, updated_at = now()
    where id = p_link
    returning * into sl;

  return sl;
end;
$$;

revoke execute on function public.confirm_sighting_link(uuid) from public, anon;
grant  execute on function public.confirm_sighting_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_sighting_link — flip a link to 'rejected'. Same ownership check as
-- confirm. Does NOT overwrite `created_by` (preserves the audit trail of who
-- confirmed, if it was previously confirmed). Reversible: a rejected link can
-- later be confirmed. Never deletes the row. Returns the updated row.
-- ---------------------------------------------------------------------------
create or replace function public.reject_sighting_link(p_link uuid)
returns public.sighting_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sl public.sighting_links;
  s  public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_link is null then raise exception 'Link required'; end if;

  select * into sl from public.sighting_links where id = p_link;
  if not found then raise exception 'Link not found'; end if;

  select * into s from public.sightings where id = sl.sighting_id;
  if not found then raise exception 'Sighting not found'; end if;
  if uid <> coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
     and uid <> coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000') then
    raise exception 'Only the reporter or assigned guardian of this sighting can reject the link';
  end if;

  update public.sighting_links
    set status = 'rejected', updated_at = now()
    where id = p_link
    returning * into sl;

  return sl;
end;
$$;

revoke execute on function public.reject_sighting_link(uuid) from public, anon;
grant  execute on function public.reject_sighting_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_sighting_links — list the suggested+confirmed links for a sighting,
-- with the linked (other-side) sighting's public fields for display. The
-- caller must be the reporter or assigned guardian of the target sighting.
-- SECURITY DEFINER so it can read sighting_links past RLS (the RLS policy is
-- reporter/guardian-visible, but the DEFINER read also returns the linked
-- sighting's public fields in one round trip). Rejected links are excluded —
-- they are history, not active suggestions.
-- ---------------------------------------------------------------------------
create or replace function public.get_sighting_links(p_sighting uuid)
returns table (
  id                 uuid,
  sighting_id        uuid,
  linked_sighting_id uuid,
  confidence         double precision,
  status             text,
  created_at         timestamptz,
  title              text,
  thumbnail_url      text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_sighting is null then raise exception 'Sighting required'; end if;

  -- Caller must be the reporter or assigned guardian of the target sighting.
  if not exists (
    select 1 from public.sightings s
    where s.id = p_sighting
      and (s.reporter_id = uid or s.claimed_by = uid)
  ) then
    raise exception 'Only the reporter or assigned guardian can view links';
  end if;

  return query
  select
    sl.id,
    sl.sighting_id,
    sl.linked_sighting_id,
    sl.confidence,
    sl.status,
    sl.created_at,
    ls.title,
    (select ph.url from public.sighting_photos ph
       where ph.sighting_id = ls.id order by ph.created_at asc limit 1)
  from public.sighting_links sl
  join public.sightings ls
    on ls.id = case when sl.sighting_id = p_sighting then sl.linked_sighting_id else sl.sighting_id end
  where (sl.sighting_id = p_sighting or sl.linked_sighting_id = p_sighting)
    and sl.status in ('suggested', 'confirmed')
  order by sl.created_at desc;
end;
$$;

revoke execute on function public.get_sighting_links(uuid) from public, anon;
grant  execute on function public.get_sighting_links(uuid) to authenticated;
