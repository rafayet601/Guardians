-- pgTAP tests for AI-M4 #5 lost-cat reunification (migration 0025): the combined
-- PostGIS geo + time + pgvector cosine lost-cat matching query, the confirm/
-- reject match RPCs, the unique-pair index, and the grant surface. Mirrors
-- reid_test.sql / ai_moderation_test.sql's style. Guards the invariants that
-- matter for the ai-embeddings-agent charter:
--   * find_lost_cat_matches returns ONLY in-window (geo + time) candidates whose
--     embedding cosine confidence >= the 0.86 threshold — near-identical vectors
--     match, orthogonal ones don't; far (geo) and old (time) are excluded;
--   * confirm_lost_cat_match sets the match to 'confirmed' AND the lost_cat to
--     'matched' AND inserts a system sighting_update that closes the loop for
--     the reporter/guardian — but NEVER auto-closes to 'closed' (matched is
--     reversible; closed is a separate owner action);
--   * a non-owner caller is rejected by confirm_lost_cat_match;
--   * reject_lost_cat_match reverses (confirmed→rejected) and never deletes the
--     row (reversibility = flipping status, not removing history);
--   * the unique (lost_cat_id, sighting_id) index prevents the same pair from
--     being suggested twice;
--   * the grant surface: anon cannot execute; authenticated can.
--
-- Run with:  supabase test db

begin;
select plan(18);

-- ── Fixtures: an owner + a neighbour, the target lost-cat post, and four
--    candidate sightings (near, far, old, orthogonal-embedding) ────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'neighbour@example.test')
  on conflict do nothing;

insert into public.profiles (id, username) values
  ('11111111-1111-1111-1111-111111111111', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'neighbour')
  on conflict do nothing;

-- Target lost-cat post: the one we search matches for. Owner 1111, at (-73, 40).
insert into public.lost_cats (id, owner_id, title, photo_url, location, last_seen_at, status)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'Miso',
  'https://example.test/miso.jpg',
  st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography,
  now(),
  'open'
);

-- Near candidate sighting: ~111m north, created now, IDENTICAL embedding (conf 1.0).
insert into public.sightings (id, reporter_id, location, status) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography,
   'spotted');

-- Far candidate sighting: ~111km north (outside the 5km default radius), identical embedding.
insert into public.sightings (id, reporter_id, location, status) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 41.0), 4326)::geography,
   'spotted');

-- Old candidate sighting: same spot as near, but 40 days ago (outside the 30-day window).
insert into public.sightings (id, reporter_id, location, status, created_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography,
   'spotted',
   now() - interval '40 days');

-- Orthogonal candidate sighting: same spot as near, created now, but an
-- ORTHOGONAL embedding (first half 0.1 / second half 0 vs the target's all-0.1
-- vector). Cosine confidence = 0, well below the 0.86 threshold.
insert into public.sightings (id, reporter_id, location, status) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '22222222-2222-2222-2222-222222222222',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography,
   'spotted');

-- ── Embeddings: 1024-dim vectors via array_fill → array_to_string → ::vector ─
-- Target lost_cat + near + far + old sightings all share the all-0.1 vector
-- (cosine confidence 1.0). Orthogonal candidate uses the half-and-half vector.
with v as (
  select ('[' || array_to_string(array_fill(0.1::float8, ARRAY[1024]), ',') || ']')::vector(1024) as vec
)
insert into public.embeddings (owner_type, owner_id, kind, embedding)
select t.owner_type, t.owner_id::uuid, t.kind, v.vec from v
cross join (values
  ('lost_cat', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lost_cat_photo'),
  ('sighting', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sighting_photo'),
  ('sighting', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'sighting_photo'),
  ('sighting', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'sighting_photo')
) as t(owner_type, owner_id, kind);

with v as (
  select ('[' || array_to_string(
    array_fill(0.0::float8, ARRAY[512]) || array_fill(0.1::float8, ARRAY[512]),
    ','
  ) || ']')::vector(1024) as vec
)
insert into public.embeddings (owner_type, owner_id, kind, embedding)
select 'sighting', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'sighting_photo', v.vec from v;

-- ── Simulate the owner's session for find_lost_cat_matches ────────────────────
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true);

-- ── find_lost_cat_matches: only the near, in-window, above-threshold ───────────
-- Returns exactly 1 candidate (near). Far (geo), old (time), and orthogonal
-- (confidence) are all excluded.
select is(
  (select count(*)::int from public.find_lost_cat_matches('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)),
  1, 'find_lost_cat_matches returns only the in-window, in-radius, above-threshold candidate');

select is(
  (select sighting_id from public.find_lost_cat_matches('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'the returned candidate is the nearby, similar sighting');

select ok(
  (select confidence from public.find_lost_cat_matches('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)) >= 0.86,
  'candidate confidence is above the 0.86 lost-cat threshold');

select ok(
  (select distance_m from public.find_lost_cat_matches('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)) < 5000,
  'candidate distance is within the 5km geo radius');

-- ── confirm_lost_cat_match: confirmed + lost_cat matched + sighting_update ─────
-- Insert a suggested match for (lost_cat, near) directly (postgres bypasses RLS).
insert into public.lost_cat_matches (id, lost_cat_id, sighting_id, confidence, status)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
        0.95, 'suggested');

-- Count loop-closing sighting_updates on the matched sighting BEFORE confirm.
-- (Every sighting insert already gets a 'Sighting reported' system update from
-- the 0002 sightings_on_created trigger, so we filter to the confirm's body.)
select is(
  (select count(*)::int from public.sighting_updates
     where sighting_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
       and body like '✅ Owner confirmed%'),
  0, 'no lost-cat confirmation update exists for the matched sighting before confirm');

-- Owner confirms → match 'confirmed', lost_cat 'matched', and a system
-- sighting_update closes the loop for the reporter/guardian. Never auto-closes
-- to 'closed' (matched is reversible; closed is a separate owner action).
select public.confirm_lost_cat_match('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
select is(
  (select status from public.lost_cat_matches where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  'confirmed', 'confirm_lost_cat_match sets the match status to confirmed');
select is(
  (select status from public.lost_cats where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'matched', 'confirm_lost_cat_match sets the lost_cat status to matched (never closed)');
select is(
  (select count(*)::int from public.sighting_updates
     where sighting_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
       and type = 'system' and body like '✅ Owner confirmed%'),
  1, 'confirm_lost_cat_match inserts exactly one loop-closing system sighting_update');

-- ── reject_lost_cat_match: reversible (confirmed→rejected), never deletes ─────
select public.reject_lost_cat_match('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
select is(
  (select status from public.lost_cat_matches where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  'rejected', 'reject_lost_cat_match flips confirmed→rejected (reversible)');
select is(
  (select count(*)::int from public.lost_cat_matches where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  1, 'reject never deletes the match row');

-- ── Non-owner cannot confirm ──────────────────────────────────────────────────
-- Switch to the neighbour (2222…), who is not the lost_cat's owner. confirm
-- must raise the owner-check error.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true);

select throws_ok(
  $$select public.confirm_lost_cat_match('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)$$,
  'Only the lost-cat owner can confirm a match',
  'non-owner cannot confirm a lost-cat match');

-- ── Unique-pair index prevents a duplicate suggestion for the same pair ───────
-- (lost_cat, near) already has a match row. Inserting the same pair again must
-- violate the unique (lost_cat_id, sighting_id) index.
select throws_ok(
  $$insert into public.lost_cat_matches (lost_cat_id, sighting_id, confidence, status)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
            0.9, 'suggested')$$,
  '23505',
  'duplicate key value violates unique constraint "lost_cat_matches_pair_uniq"',
  'unique (lost_cat_id, sighting_id) index prevents a duplicate suggestion');

-- ── Grant surface: anon cannot; authenticated can ─────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.find_lost_cat_matches(uuid, int, int, int)', 'execute'),
  'anon cannot execute find_lost_cat_matches');
select ok(
  has_function_privilege('authenticated', 'public.find_lost_cat_matches(uuid, int, int, int)', 'execute'),
  'authenticated can execute find_lost_cat_matches');

select ok(
  not has_function_privilege('anon', 'public.confirm_lost_cat_match(uuid)', 'execute'),
  'anon cannot execute confirm_lost_cat_match');
select ok(
  has_function_privilege('authenticated', 'public.confirm_lost_cat_match(uuid)', 'execute'),
  'authenticated can execute confirm_lost_cat_match');

select ok(
  not has_function_privilege('anon', 'public.get_lost_cat_matches(uuid)', 'execute'),
  'anon cannot execute get_lost_cat_matches');
select ok(
  has_function_privilege('authenticated', 'public.get_lost_cat_matches(uuid)', 'execute'),
  'authenticated can execute get_lost_cat_matches');

select * from finish();
rollback;
