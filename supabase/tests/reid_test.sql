-- pgTAP tests for AI-M3 #4 re-ID (migration 0023): the combined geo+time+vector
-- duplicate-sighting query, the confirm/reject link RPCs, and the unique-pair
-- index. Mirrors lifecycle_test.sql / ai_moderation_test.sql's style. Guards
-- the invariants that matter for the ai-embeddings-agent charter:
--   * find_sighting_duplicates returns ONLY in-window (geo + time) candidates
--     whose embedding cosine confidence >= the 0.82 threshold — near-identical
--     vectors match, orthogonal ones don't;
--   * a confirmed link can be rejected (reversibility — never deletes the row);
--   * a non-reporter / non-guardian is rejected by confirm_sighting_link;
--   * the unique-pair index prevents the same pair from being suggested twice;
--   * the grant surface: anon cannot execute; authenticated can.
--
-- Run with:  supabase test db

begin;
select plan(17);

-- ── Fixtures: a reporter + a neighbour, the target sighting, and four
--    candidate sightings (near, far, old, orthogonal-embedding) ─────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'reporter@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'neighbour@example.test')
  on conflict do nothing;

insert into public.profiles (id, username) values
  ('11111111-1111-1111-1111-111111111111', 'reporter'),
  ('22222222-2222-2222-2222-222222222222', 'neighbour')
  on conflict do nothing;

-- Target sighting: the one we search duplicates for.
insert into public.sightings (id, reporter_id, location, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography,
   'spotted');

-- Near candidate: ~111m north, created now, IDENTICAL embedding (confidence 1.0).
insert into public.sightings (id, reporter_id, location, status) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography,
   'spotted');

-- Far candidate: ~111km north (outside the 2km default radius), identical embedding.
insert into public.sightings (id, reporter_id, location, status) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 41.0), 4326)::geography,
   'spotted');

-- Old candidate: same spot as near, but 10 days ago (outside the 168h window).
insert into public.sightings (id, reporter_id, location, status, created_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography,
   'spotted',
   now() - interval '10 days');

-- Orthogonal candidate: same spot as near, created now, but an ORTHOGONAL
-- embedding (first half 0.1 / second half 0 vs the target's all-0.1 vector).
-- Cosine confidence = 0, well below the 0.82 threshold.
insert into public.sightings (id, reporter_id, location, status) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography,
   'spotted');

-- ── Embeddings: 1024-dim vectors via array_fill → array_to_string → ::vector ─
-- Target + near + far + old all share the all-0.1 vector (cosine confidence 1.0).
-- Orthogonal candidate uses the half-and-half vector (cosine confidence 0).
with v as (
  select ('[' || array_to_string(array_fill(0.1::float8, ARRAY[1024]), ',') || ']')::vector(1024) as vec
)
insert into public.embeddings (owner_type, owner_id, kind, embedding)
select 'sighting', id, 'sighting_photo', v.vec from v
cross join (values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd')
) as t(id::uuid);

with v as (
  select ('[' || array_to_string(
    array_fill(0.0::float8, ARRAY[512]) || array_fill(0.1::float8, ARRAY[512]),
    ','
  ) || ']')::vector(1024) as vec
)
insert into public.embeddings (owner_type, owner_id, kind, embedding)
select 'sighting', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'sighting_photo', v.vec from v;

-- ── Simulate the reporter's session for find_sighting_duplicates ─────────────
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true);

-- ── find_sighting_duplicates: only the near, in-window, above-threshold ───────
-- Returns exactly 1 candidate (near). Far (geo), old (time), and orthogonal
-- (confidence) are all excluded.
select is(
  (select count(*)::int from public.find_sighting_duplicates('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)),
  1, 'find_sighting_duplicates returns only the in-window, in-radius, above-threshold candidate');

select is(
  (select linked_sighting_id from public.find_sighting_duplicates('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'the returned candidate is the nearby, similar sighting');

select ok(
  (select confidence from public.find_sighting_duplicates('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)) >= 0.82,
  'candidate confidence is above the 0.82 threshold');

select ok(
  (select distance_m from public.find_sighting_duplicates('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)) < 2000,
  'candidate distance is within the 2km geo radius');

-- distance_m comes from coarse (~110m-snapped) endpoints, never precise ones —
-- exact meters from a caller-chosen point could be trilaterated back to the
-- candidate's precise coordinates.
select is(
  (select distance_m from public.find_sighting_duplicates('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)),
  (select st_distance(public.coarse_location(s2.location), public.coarse_location(s1.location))::double precision
     from public.sightings s1, public.sightings s2
    where s1.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      and s2.id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  'distance_m is computed from coarse endpoints (trilateration guard)');

-- ── confirm_sighting_link / reject_sighting_link: reversible, never deletes ──
-- Insert a suggested link for (target, near) directly (postgres bypasses RLS).
insert into public.sighting_links (id, sighting_id, linked_sighting_id, confidence, status)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
        0.95, 'suggested');

-- Reporter confirms → status = 'confirmed'.
select public.confirm_sighting_link('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
select is(
  (select status from public.sighting_links where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  'confirmed', 'confirm_sighting_link sets status to confirmed');

-- Reporter rejects (reversibility) → status = 'rejected'.
select public.reject_sighting_link('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
select is(
  (select status from public.sighting_links where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  'rejected', 'reject_sighting_link flips confirmed→rejected (reversible)');

-- Row still exists — never deletes.
select is(
  (select count(*)::int from public.sighting_links where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  1, 'reject never deletes the link row');

-- ── Non-reporter / non-guardian cannot confirm ───────────────────────────────
-- Switch to the neighbour (2222…), who is neither reporter nor guardian of the
-- target sighting (sighting_id of the link). confirm must raise.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true);

select throws_ok(
  $$select public.confirm_sighting_link('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)$$,
  'Only the reporter or assigned guardian of this sighting can confirm the link',
  'non-reporter/non-guardian cannot confirm a link');

-- The duplicate search itself is owner-gated too: the RPC is directly callable
-- via PostgREST, so it must not rely on the ai-reid edge function's check.
select throws_ok(
  $$select count(*) from public.find_sighting_duplicates('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)$$,
  'Only the reporter or assigned guardian can search duplicates for this sighting',
  'non-reporter/non-guardian cannot probe find_sighting_duplicates');

-- ── Unique-pair index prevents a duplicate suggestion for the same pair ───────
-- (target, near) already has a link row. Inserting the reversed pair (near,
-- target) must violate the unordered unique index.
select throws_ok(
  $$insert into public.sighting_links (sighting_id, linked_sighting_id, confidence, status)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
            0.9, 'suggested')$$,
  '23505',
  'unique-pair index prevents a duplicate suggestion for the same pair');

-- ── Grant surface: anon cannot; authenticated can ─────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.find_sighting_duplicates(uuid, int, int, int)', 'execute'),
  'anon cannot execute find_sighting_duplicates');
select ok(
  has_function_privilege('authenticated', 'public.find_sighting_duplicates(uuid, int, int, int)', 'execute'),
  'authenticated can execute find_sighting_duplicates');

select ok(
  not has_function_privilege('anon', 'public.confirm_sighting_link(uuid)', 'execute'),
  'anon cannot execute confirm_sighting_link');
select ok(
  has_function_privilege('authenticated', 'public.confirm_sighting_link(uuid)', 'execute'),
  'authenticated can execute confirm_sighting_link');

select ok(
  not has_function_privilege('anon', 'public.get_sighting_links(uuid)', 'execute'),
  'anon cannot execute get_sighting_links');
select ok(
  has_function_privilege('authenticated', 'public.get_sighting_links(uuid)', 'execute'),
  'authenticated can execute get_sighting_links');

select * from finish();
rollback;
