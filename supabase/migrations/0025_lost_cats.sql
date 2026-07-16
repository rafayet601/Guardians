-- ============================================================================
-- Guardians — 0025_lost_cats
-- AI-M4 #5 — Lost-cat reunification matching engine. A lost-cat post (photo,
-- last-seen location/time) is continuously matched against sightings by a
-- COMBINED PostGIS geo + time + pgvector cosine window. When a new sighting
-- matches an open lost-cat post, the ai-lost-match edge function pushes the
-- owner ("a cat matching Miso was spotted ~400m from where they went missing").
-- The owner confirms or rejects; confirming closes the loop by posting a system
-- sighting_update the reporter/guardian sees. NEVER auto-close a lost_cat
-- without the owner's confirm. NEVER delete a match row — confirmed/rejected
-- only flips status (reversible). Confidence, not certainty: the UI says "a cat
-- matching X", never "this is X".
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Every function pins search_path and follows
-- the 0014/0016/0019/0020/0021/0023 convention: revoke public/anon, grant only
-- to the role that must call it. `lost_cat_matches` has RLS with a
-- lost_cat-owner / sighting-reporter-or-guardian SELECT policy and NO client
-- INSERT/UPDATE/DELETE policy (writes go through the confirm/reject SECURITY
-- DEFINER RPCs or the service-role edge function), exactly like sighting_links
-- (0023) and embeddings (0019). `lost_cats` is community-visible (neighbours
-- can help look) but its raw lat/lng/location columns are REVOKED from clients
-- at the column level — coordinates cross the wire only through the
-- `get_lost_cat` / `get_my_lost_cats` RPCs, which coarsen for non-owners
-- (mirroring get_sighting_detail from 0009). This is stricter than sightings
-- (0004) by design: the task explicitly forbids exposing raw lost-cat coords to
-- non-owners, and the ai-embeddings-agent charter says "never widen location
-- precision."
--
-- CONFIDENCE THRESHOLD: 0.86 (1 - cosine_distance), set in both find_* RPCs.
-- This is STRICTER than re-ID's 0.82 (0023) on purpose. A re-ID false positive
-- merges two records the user compares side-by-side (reversible, low travel
-- cost); a lost-cat false positive sends the owner to a DIFFERENT cat at a
-- wrong location — wasted emotional + physical effort that erodes trust in the
-- flagship feature ("false negatives are safer than false positives"). +0.04
-- over re-ID raises the bar on top of the same caption-then-embed noise (an
-- ~80-word text description loses visual detail a true multimodal embedding
-- would preserve). Tunable in one place per function.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- lost_cats — one row per "I lost my cat" post. status is open|matched|closed;
-- open means still looking, matched means the owner confirmed a sighting match,
-- closed means the cat came home (or the post was withdrawn). The owner drives
-- every status change: confirm_lost_cat_match sets matched; nothing auto-closes.
-- location is the source of truth (matches sightings 0001); lat/lng are derived
-- generated columns. Raw coords are never client-readable (see column grants).
-- ---------------------------------------------------------------------------
create table if not exists public.lost_cats (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  title        text,
  description  text,
  photo_url    text not null,
  lat          double precision generated always as (st_y(location::geometry)) stored,
  lng          double precision generated always as (st_x(location::geometry)) stored,
  location     geography(Point, 4326) not null,
  last_seen_at timestamptz not null,
  status       text not null default 'open'
                 check (status in ('open', 'matched', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists lost_cats_location_gix on public.lost_cats using gist (location);
create index if not exists lost_cats_owner_idx     on public.lost_cats (owner_id);
create index if not exists lost_cats_status_idx    on public.lost_cats (status);
create index if not exists lost_cats_created_idx   on public.lost_cats (created_at desc);

-- updated_at maintenance (reuses the shared trigger fn from 0002).
drop trigger if exists lost_cats_set_updated_at on public.lost_cats;
create trigger lost_cats_set_updated_at
  before update on public.lost_cats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS for lost_cats. Community-visible rows (neighbours can help look), owner
-- CRUD on their own. status is RPC-controlled (confirm_lost_cat_match flips it
-- to 'matched'); the column-level update grant excludes status. Crucially,
-- raw lat/lng/location are REVOKED from anon + authenticated so a direct
-- `select lat, lng from lost_cats` is denied for everyone — precise coords
-- reach the owner only through get_my_lost_cats / get_lost_cat (SECURITY
-- DEFINER, run as the table owner), and reach non-owners only as ~110m-
-- coarsened values through get_lost_cat. This enforces the "never widen
-- location precision" charter rule at the DB layer instead of relying on the
-- API convention alone (sightings 0004 relies on convention; lost_cats is
-- stricter per the AI-M4 task spec).
-- ---------------------------------------------------------------------------
alter table public.lost_cats enable row level security;

drop policy if exists "lost cats are viewable by authenticated" on public.lost_cats;
create policy "lost cats are viewable by authenticated"
  on public.lost_cats for select to authenticated using (true);

drop policy if exists "owners create their lost cats" on public.lost_cats;
create policy "owners create their lost cats"
  on public.lost_cats for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "owners edit their lost cats" on public.lost_cats;
create policy "owners edit their lost cats"
  on public.lost_cats for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "owners delete their lost cats" on public.lost_cats;
create policy "owners delete their lost cats"
  on public.lost_cats for delete to authenticated
  using (owner_id = auth.uid());

-- Lock down the coordinate + status columns. Clients can only SELECT the
-- non-coordinate columns and only UPDATE the descriptive fields. lat/lng are
-- generated (unreadable + unwritable here); location is revoked too. status is
-- mutated only via the confirm/reject RPCs (SECURITY DEFINER).
revoke select on public.lost_cats from anon, authenticated;
grant  select (id, owner_id, title, description, photo_url, last_seen_at, status, created_at, updated_at)
  on public.lost_cats to authenticated;

revoke update on public.lost_cats from anon, authenticated;
grant  update (title, description, photo_url, last_seen_at)
  on public.lost_cats to authenticated;

-- ---------------------------------------------------------------------------
-- lost_cat_matches — one row per suggested/confirmed/rejected (lost_cat,
-- sighting) pair. The unique (lost_cat_id, sighting_id) index ensures the same
-- pair is never suggested twice. status is suggested|confirmed|rejected and is
-- NEVER used to delete a row — reversibility means flipping the status, not
-- removing history. ON DELETE RESTRICT preserves match history even if a
-- lost_cat post is deleted by its owner.
-- ---------------------------------------------------------------------------
create table if not exists public.lost_cat_matches (
  id           uuid primary key default gen_random_uuid(),
  lost_cat_id  uuid not null references public.lost_cats (id) on delete restrict,
  sighting_id  uuid not null references public.sightings (id) on delete restrict,
  confidence   double precision,
  status       text not null default 'suggested'
                 check (status in ('suggested', 'confirmed', 'rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists lost_cat_matches_pair_uniq
  on public.lost_cat_matches (lost_cat_id, sighting_id);
create index if not exists lost_cat_matches_lost_cat_idx on public.lost_cat_matches (lost_cat_id);
create index if not exists lost_cat_matches_sighting_idx  on public.lost_cat_matches (sighting_id);
create index if not exists lost_cat_matches_status_idx    on public.lost_cat_matches (status);

drop trigger if exists lost_cat_matches_set_updated_at on public.lost_cat_matches;
create trigger lost_cat_matches_set_updated_at
  before update on public.lost_cat_matches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS for lost_cat_matches. Readable when the caller is the lost_cat owner OR
-- the reporter/guardian of the matched sighting (so the reporter sees "the
-- owner confirmed this is their cat"). No client INSERT/UPDATE/DELETE policy —
-- writes go through confirm_lost_cat_match / reject_lost_cat_match (SECURITY
-- DEFINER, below) or the service-role ai-lost-match edge function.
-- ---------------------------------------------------------------------------
alter table public.lost_cat_matches enable row level security;

drop policy if exists "matches visible to lost owner or sighting reporter/guardian" on public.lost_cat_matches;
create policy "matches visible to lost owner or sighting reporter/guardian"
  on public.lost_cat_matches for select to authenticated
  using (
    exists (
      select 1 from public.lost_cats lc
      where lc.id = lost_cat_id and lc.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.sightings s
      where s.id = sighting_id
        and (s.reporter_id = auth.uid() or s.claimed_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- create_lost_cat — insert a lost-cat post (owner = auth.uid(), status 'open').
-- Builds the PostGIS location server-side from p_lat/p_lng so the client never
-- serializes geography (mirrors create_sighting in 0002). Returns the new row.
-- SECURITY DEFINER so it can write the generated-location row past the
-- coordinate-column revoke (the insert sets location; lat/lng derive from it).
-- ---------------------------------------------------------------------------
create or replace function public.create_lost_cat(
  p_lat          double precision,
  p_lng          double precision,
  p_last_seen_at timestamptz,
  p_title        text default null,
  p_description  text default null,
  p_photo_url    text default null
)
returns public.lost_cats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  lc  public.lost_cats;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid coordinates';
  end if;
  if p_last_seen_at is null then raise exception 'last_seen_at is required'; end if;
  if p_photo_url is null or nullif(trim(p_photo_url), '') is null then
    raise exception 'photo_url is required';
  end if;

  insert into public.lost_cats (
    owner_id, title, description, photo_url, location, last_seen_at, status
  )
  values (
    uid,
    nullif(trim(p_title), ''),
    nullif(trim(p_description), ''),
    trim(p_photo_url),
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    p_last_seen_at,
    'open'
  )
  returning * into lc;

  return lc;
end;
$$;

revoke execute on function public.create_lost_cat(
  double precision, double precision, timestamptz, text, text, text
) from public, anon;
grant  execute on function public.create_lost_cat(
  double precision, double precision, timestamptz, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_lost_cats — the caller's own posts with PRECISE coordinates (the owner
-- reading their own posts). SECURITY DEFINER so it can read lat/lng past the
-- coordinate-column revoke. Returns the row shape the client normalizes to
-- LostCat. Ordered newest-first.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_lost_cats()
returns table (
  id           uuid,
  owner_id     uuid,
  title        text,
  description  text,
  photo_url    text,
  lat          double precision,
  lng          double precision,
  last_seen_at timestamptz,
  status       text,
  created_at   timestamptz,
  updated_at   timestamptz
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

  return query
  select
    lc.id, lc.owner_id, lc.title, lc.description, lc.photo_url,
    lc.lat, lc.lng, lc.last_seen_at, lc.status, lc.created_at, lc.updated_at
  from public.lost_cats lc
  where lc.owner_id = uid
  order by lc.created_at desc;
end;
$$;

revoke execute on function public.get_my_lost_cats() from public, anon;
grant  execute on function public.get_my_lost_cats() to authenticated;

-- ---------------------------------------------------------------------------
-- get_lost_cat — single lost-cat post, coarsened for non-owners and precise for
-- the owner (mirrors get_sighting_detail from 0009). Returns jsonb so the
-- caller can read is_precise to render an approximate area instead of a
-- false-precision pin. SECURITY DEFINER so it can read lat/lng past the
-- coordinate-column revoke. Community-visible (any authenticated caller).
-- ---------------------------------------------------------------------------
create or replace function public.get_lost_cat(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  lc        public.lost_cats;
  v_precise boolean;
  v_lat     double precision;
  v_lng     double precision;
  result    jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_id is null then raise exception 'Lost cat id required'; end if;

  select * into lc from public.lost_cats where id = p_id;
  if not found then raise exception 'Lost cat not found'; end if;

  -- Precise coordinates are shared only with the owner. (A future matched
  -- reporter/guardian could be added here, but the match result already carries
  -- distance_m; the owner confirms before any precise-coordinate handoff.)
  v_precise := (uid = lc.owner_id);

  if v_precise then
    v_lat := lc.lat;
    v_lng := lc.lng;
  else
    v_lat := round(lc.lat::numeric, 3)::double precision;
    v_lng := round(lc.lng::numeric, 3)::double precision;
  end if;

  result := jsonb_build_object(
    'id',           lc.id,
    'owner_id',     lc.owner_id,
    'title',        lc.title,
    'description',  lc.description,
    'photo_url',    lc.photo_url,
    'lat',          v_lat,
    'lng',          v_lng,
    'last_seen_at', lc.last_seen_at,
    'status',       lc.status,
    'created_at',   lc.created_at,
    'updated_at',   lc.updated_at,
    'is_precise',   v_precise
  );

  return result;
end;
$$;

revoke execute on function public.get_lost_cat(uuid) from public, anon;
grant  execute on function public.get_lost_cat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- find_lost_cat_matches — the combined PostGIS geo + time + pgvector cosine
-- nearest-neighbour query that powers "a cat matching your lost cat was
-- spotted ~400m away." Takes the lost_cat's `lost_cat_photo` embedding and
-- finds nearest sightings' `sighting_photo` embeddings by cosine <=>, filtered
-- by st_dwithin < p_radius_m AND sightings.created_at within now() -
-- p_max_age_days AND sightings.status not archived AND not hidden, excluding
-- pairs already confirmed/rejected (a rejected pair is never re-suggested).
-- Returns PUBLIC sighting fields + distance_m + confidence — NEVER the
-- candidate sighting's raw coordinates. distance_m and the radius filter use
-- coarse_location() (~110m snap, defined in 0023) of both endpoints: exact
-- distances from a caller-chosen point are trilaterable back to the precise
-- coordinate, so meters derived from precise locations must never cross the
-- wire. `match_id` is the existing suggested
-- lost_cat_matches row id (null when this pair is new), so the edge function
-- can insert+push only for new pairs and refresh confidence for existing ones.
--
-- Confidence = 1 - cosine_distance. Threshold 0.86 — STRICTER than re-ID's
-- 0.82 because a lost-cat false positive sends the owner to the wrong cat at a
-- wrong location (see migration header). Granted to authenticated; the body
-- requires the caller to be the lost_cat's owner (the ai-lost-match edge
-- function verifies this too, and calls via the caller client so auth.uid() is
-- the owner — defense in depth).
-- ---------------------------------------------------------------------------
create or replace function public.find_lost_cat_matches(
  p_lost_cat    uuid,
  p_radius_m    int default 5000,
  p_max_age_days int default 30,
  p_limit       int default 5
)
returns table (
  sighting_id    uuid,
  title          text,
  thumbnail_url  text,
  status         text,
  created_at     timestamptz,
  distance_m     double precision,
  confidence     double precision,
  match_id       uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Confidence threshold (1 - cosine_distance). See function + migration header
  -- for why 0.86 (false negatives safer than false positives for lost-cat).
  v_threshold double precision := 0.86;
  v_radius    double precision := greatest(100, least(coalesce(p_radius_m, 5000), 50000))::double precision;
  v_days      int      := greatest(1, least(coalesce(p_max_age_days, 30), 365));
  v_limit     int      := greatest(1, least(coalesce(p_limit, 5), 20));
  uid         uuid     := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_lost_cat is null then raise exception 'Lost cat id required'; end if;

  -- Caller must own the lost_cat (defense in depth on top of the edge function).
  if not exists (
    select 1 from public.lost_cats lc where lc.id = p_lost_cat and lc.owner_id = uid
  ) then
    raise exception 'Only the owner can search for matches on their lost cat';
  end if;

  return query
  with target as (
    select lc.location as precise_location,
           public.coarse_location(lc.location) as location,
           e.embedding
    from public.lost_cats lc
    join public.embeddings e
      on e.owner_type = 'lost_cat' and e.owner_id = lc.id and e.kind = 'lost_cat_photo'
    where lc.id = p_lost_cat
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
    m.id
  from public.sightings s2
  join public.embeddings e2
    on e2.owner_type = 'sighting' and e2.owner_id = s2.id and e2.kind = 'sighting_photo'
  cross join target t
  left join public.lost_cat_matches m
    on m.lost_cat_id = p_lost_cat and m.sighting_id = s2.id and m.status = 'suggested'
  where s2.status <> 'archived'
    and s2.is_hidden = false
    -- Index-friendly pre-filter on the precise column, padded so it can never
    -- exclude a pair the coarse filter accepts (see coarse_location in 0023).
    and st_dwithin(s2.location, t.precise_location, v_radius + 320)
    and st_dwithin(public.coarse_location(s2.location), t.location, v_radius)
    and s2.created_at > now() - make_interval(days => v_days)
    and (1.0 - (e2.embedding <=> t.embedding)) >= v_threshold
    and not exists (
      select 1 from public.lost_cat_matches m2
      where m2.lost_cat_id = p_lost_cat and m2.sighting_id = s2.id
        and m2.status in ('confirmed', 'rejected')
    )
  order by e2.embedding <=> t.embedding
  limit v_limit;
end;
$$;

revoke execute on function public.find_lost_cat_matches(uuid, int, int, int) from public, anon;
grant  execute on function public.find_lost_cat_matches(uuid, int, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- find_lost_cats_for_sighting — the REVERSE combined query: open lost_cats that
-- match a just-created sighting (used when a new sighting comes in). Same geo +
-- time + vector window, opposite direction. Returns (lost_cat_id, owner_id,
-- title, confidence, distance_m, match_id) — owner_id so the edge function knows
-- whose device to push, distance_m for the push body. NEVER the lost_cat's raw
-- coordinates: distance_m and the radius filter use coarse_location() (0023)
-- of both endpoints, since exact meters from a caller-chosen sighting point
-- would let the caller trilaterate the lost cat's (owner's home) location.
-- Granted to authenticated; the body requires the caller to be the sighting's
-- reporter or assigned guardian (the ai-lost-match edge function verifies this
-- too and calls via the caller client).
-- ---------------------------------------------------------------------------
create or replace function public.find_lost_cats_for_sighting(
  p_sighting     uuid,
  p_radius_m     int default 5000,
  p_max_age_days int default 30,
  p_limit        int default 5
)
returns table (
  lost_cat_id  uuid,
  owner_id     uuid,
  title        text,
  confidence   double precision,
  distance_m   double precision,
  match_id     uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_threshold double precision := 0.86;
  v_radius    double precision := greatest(100, least(coalesce(p_radius_m, 5000), 50000))::double precision;
  v_days      int      := greatest(1, least(coalesce(p_max_age_days, 30), 365));
  v_limit     int      := greatest(1, least(coalesce(p_limit, 5), 20));
  uid         uuid     := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_sighting is null then raise exception 'Sighting id required'; end if;

  -- Caller must be the sighting's reporter or assigned guardian.
  if not exists (
    select 1 from public.sightings s
    where s.id = p_sighting
      and (s.reporter_id = uid or s.claimed_by = uid)
  ) then
    raise exception 'Only the reporter or assigned guardian can match this sighting';
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
    lc.id,
    lc.owner_id,
    lc.title,
    (1.0 - (e2.embedding <=> t.embedding))::double precision,
    st_distance(public.coarse_location(lc.location), t.location)::double precision,
    m.id
  from public.lost_cats lc
  join public.embeddings e2
    on e2.owner_type = 'lost_cat' and e2.owner_id = lc.id and e2.kind = 'lost_cat_photo'
  cross join target t
  left join public.lost_cat_matches m
    on m.lost_cat_id = lc.id and m.sighting_id = p_sighting and m.status = 'suggested'
  where lc.status = 'open'
    -- Index-friendly pre-filter on the precise column, padded so it can never
    -- exclude a pair the coarse filter accepts (see coarse_location in 0023).
    and st_dwithin(lc.location, t.precise_location, v_radius + 320)
    and st_dwithin(public.coarse_location(lc.location), t.location, v_radius)
    and lc.last_seen_at > now() - make_interval(days => v_days)
    and (1.0 - (e2.embedding <=> t.embedding)) >= v_threshold
    and not exists (
      select 1 from public.lost_cat_matches m2
      where m2.lost_cat_id = lc.id and m2.sighting_id = p_sighting
        and m2.status in ('confirmed', 'rejected')
    )
  order by e2.embedding <=> t.embedding
  limit v_limit;
end;
$$;

revoke execute on function public.find_lost_cats_for_sighting(uuid, int, int, int) from public, anon;
grant  execute on function public.find_lost_cats_for_sighting(uuid, int, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- get_lost_cat_matches — the suggested+confirmed matches for a lost-cat post,
-- with the matched sighting's public fields for display. distance_m is computed
-- at read time from coarse_location() (0023) of the two PostGIS locations (the
-- match row stores no distance; sightings don't move) — coarse on BOTH sides
-- because each party may call this while only being entitled to the OTHER
-- party's coarse coordinates. The caller must be the lost_cat owner OR the reporter/
-- guardian of the matched sighting (so the reporter sees "the owner confirmed").
-- SECURITY DEFINER so it can read lost_cat_matches past RLS and compute distance
-- from both locations. Rejected matches are excluded — they are history, not
-- active suggestions.
-- ---------------------------------------------------------------------------
create or replace function public.get_lost_cat_matches(p_lost_cat uuid)
returns table (
  id                    uuid,
  lost_cat_id           uuid,
  sighting_id           uuid,
  confidence            double precision,
  distance_m            double precision,
  status                text,
  created_at            timestamptz,
  sighting_title        text,
  sighting_thumbnail_url text,
  sighting_created_at   timestamptz
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
  if p_lost_cat is null then raise exception 'Lost cat id required'; end if;

  -- Caller must be the lost_cat owner, or the reporter/guardian of one of the
  -- matched sightings (the RLS policy already gates row visibility, but this
  -- RPC runs as SECURITY DEFINER so it re-checks explicitly).
  if not exists (
    select 1 from public.lost_cats lc
    where lc.id = p_lost_cat and lc.owner_id = uid
  ) and not exists (
    select 1
    from public.lost_cat_matches m
    join public.sightings s on s.id = m.sighting_id
    where m.lost_cat_id = p_lost_cat
      and (s.reporter_id = uid or s.claimed_by = uid)
  ) then
    raise exception 'Only the lost-cat owner or the matched sighting reporter/guardian can view matches';
  end if;

  return query
  select
    m.id,
    m.lost_cat_id,
    m.sighting_id,
    m.confidence,
    st_distance(public.coarse_location(s.location), public.coarse_location(lc.location))::double precision,
    m.status,
    m.created_at,
    s.title,
    (select ph.url from public.sighting_photos ph
       where ph.sighting_id = s.id order by ph.created_at asc limit 1),
    s.created_at
  from public.lost_cat_matches m
  join public.lost_cats lc  on lc.id = m.lost_cat_id
  join public.sightings s   on s.id = m.sighting_id
  where m.lost_cat_id = p_lost_cat
    and m.status in ('suggested', 'confirmed')
  order by
    case m.status when 'confirmed' then 0 else 1 end,
    m.created_at desc;
end;
$$;

revoke execute on function public.get_lost_cat_matches(uuid) from public, anon;
grant  execute on function public.get_lost_cat_matches(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_lost_cat_match — the owner says "yes, this sighting is my lost cat."
-- Flips the match to 'confirmed', sets the lost_cat status to 'matched', and
-- inserts a SYSTEM sighting_update on the matched sighting ("Owner confirmed:
-- this is their lost cat") so the reporter/guardian sees the loop close. The
-- caller must be the lost_cat's owner. SECURITY DEFINER so it can write past the
-- no-client-write RLS on lost_cat_matches, update lost_cat.status past the
-- column-level update revoke, and insert a system sighting_update (only comment
-- rows are client-insertable per 0004). Reversible via reject_lost_cat_match.
-- Never deletes the row. Returns the updated match.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_lost_cat_match(p_match uuid)
returns public.lost_cat_matches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m   public.lost_cat_matches;
  lc  public.lost_cats;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_match is null then raise exception 'Match id required'; end if;

  select * into m from public.lost_cat_matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;

  select * into lc from public.lost_cats where id = m.lost_cat_id;
  if not found then raise exception 'Lost cat not found'; end if;
  if uid <> lc.owner_id then
    raise exception 'Only the lost-cat owner can confirm a match';
  end if;

  update public.lost_cat_matches
    set status = 'confirmed', updated_at = now()
    where id = p_match
    returning * into m;

  -- Mark the lost-cat post as matched (owner confirmed a sighting). Never
  -- auto-close: 'matched' is reversible; 'closed' is a separate owner action.
  update public.lost_cats
    set status = 'matched', updated_at = now()
    where id = m.lost_cat_id and status <> 'closed';

  -- Close the loop for the reporter/guardian: a system timeline note on the
  -- matched sighting. author_id = the owner so the reporter can see who.
  insert into public.sighting_updates (sighting_id, author_id, type, body)
  values (m.sighting_id, uid, 'system',
          '✅ Owner confirmed: this is their lost cat');

  return m;
end;
$$;

revoke execute on function public.confirm_lost_cat_match(uuid) from public, anon;
grant  execute on function public.confirm_lost_cat_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_lost_cat_match — the owner says "no, not my cat." Flips the match to
-- 'rejected' (reversible — can be confirmed later). Does NOT change the
-- lost_cat status: rejecting one sighting doesn't close the post; other
-- sightings may still be the cat. Owner-only. Never deletes the row. Returns
-- the updated match.
-- ---------------------------------------------------------------------------
create or replace function public.reject_lost_cat_match(p_match uuid)
returns public.lost_cat_matches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  m   public.lost_cat_matches;
  lc  public.lost_cats;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_match is null then raise exception 'Match id required'; end if;

  select * into m from public.lost_cat_matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;

  select * into lc from public.lost_cats where id = m.lost_cat_id;
  if not found then raise exception 'Lost cat not found'; end if;
  if uid <> lc.owner_id then
    raise exception 'Only the lost-cat owner can reject a match';
  end if;

  update public.lost_cat_matches
    set status = 'rejected', updated_at = now()
    where id = p_match
    returning * into m;

  return m;
end;
$$;

revoke execute on function public.reject_lost_cat_match(uuid) from public, anon;
grant  execute on function public.reject_lost_cat_match(uuid) to authenticated;
