-- pgTAP tests for read-path privacy (migration 0036):
--   1. blocking hides a blocked user's REPORTS and COMMENTS from the blocker,
--      one way only, with moderators exempt on reports;
--   2. nearby_sightings measures distance, radius and order against the
--      COARSENED point, so a chosen search origin cannot be used to solve for a
--      cat's exact location (the invariant get_sighting_detail + location_
--      privacy_test already protect for the detail view).
-- Mirrors location_privacy_test.sql's style.
--
-- Run with:  supabase test db

begin;
select plan(19);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('e1e1e1e1-0000-0000-0000-000000000001', 'viewer@example.test'),
  ('e1e1e1e1-0000-0000-0000-000000000002', 'blocked@example.test'),
  ('e1e1e1e1-0000-0000-0000-000000000003', 'other@example.test'),
  ('e1e1e1e1-0000-0000-0000-000000000004', 'mod@example.test')
  on conflict do nothing;
insert into public.profiles (id, username) values
  ('e1e1e1e1-0000-0000-0000-000000000001', 'rp_viewer'),
  ('e1e1e1e1-0000-0000-0000-000000000002', 'rp_blocked'),
  ('e1e1e1e1-0000-0000-0000-000000000003', 'rp_other'),
  ('e1e1e1e1-0000-0000-0000-000000000004', 'rp_mod')
  on conflict do nothing;
update public.profiles set is_moderator = true
 where id = 'e1e1e1e1-0000-0000-0000-000000000004';

-- sB: reported by the user who will be blocked, at a precise 6-decimal point.
-- sC: reported by someone else, ~780 m north (so a small radius separates them).
insert into public.sightings (id, reporter_id, location, status) values
  ('e2e2e2e2-0000-0000-0000-00000000000b', 'e1e1e1e1-0000-0000-0000-000000000002',
   st_setsrid(st_makepoint(-73.987654, 40.123456), 4326)::geography, 'spotted'),
  ('e2e2e2e2-0000-0000-0000-00000000000c', 'e1e1e1e1-0000-0000-0000-000000000003',
   st_setsrid(st_makepoint(-73.987654, 40.130456), 4326)::geography, 'spotted');

-- Two comments on sC: one from the person who will be blocked, one from another.
insert into public.sighting_updates (sighting_id, author_id, type, body) values
  ('e2e2e2e2-0000-0000-0000-00000000000c', 'e1e1e1e1-0000-0000-0000-000000000002',
   'comment', 'from the blocked user'),
  ('e2e2e2e2-0000-0000-0000-00000000000c', 'e1e1e1e1-0000-0000-0000-000000000003',
   'comment', 'from someone else');

-- ═════════════════════ Blocking ═════════════════════════════════════════════

-- As the viewer, before blocking anyone: everything is visible.
select set_config('request.jwt.claim.sub', 'e1e1e1e1-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims',
  '{"sub":"e1e1e1e1-0000-0000-0000-000000000001","role":"authenticated"}', true);
set role authenticated;

select is(
  (select count(*)::int from public.sightings
    where id in ('e2e2e2e2-0000-0000-0000-00000000000b', 'e2e2e2e2-0000-0000-0000-00000000000c')),
  2, 'before blocking, the viewer sees both reports');
select is(
  (select count(*)::int from public.nearby_sightings(40.127, -73.987654, 5000)),
  2, 'before blocking, nearby_sightings returns both');
select is(
  (select count(*)::int from public.sighting_updates
    where sighting_id = 'e2e2e2e2-0000-0000-0000-00000000000c' and type = 'comment'),
  2, 'before blocking, both comments are visible');

-- The viewer blocks the reporter of sB (owner-managed, so this runs as the viewer).
select lives_ok(
  $$insert into public.user_blocks (blocker_id, blocked_id)
    values ('e1e1e1e1-0000-0000-0000-000000000001', 'e1e1e1e1-0000-0000-0000-000000000002')$$,
  'a user can block another user');

select is(
  (select count(*)::int from public.sightings
    where id = 'e2e2e2e2-0000-0000-0000-00000000000b'),
  0, 'after blocking, the blocked user''s report is gone from the table');
select is(
  (select count(*)::int from public.sightings
    where id = 'e2e2e2e2-0000-0000-0000-00000000000c'),
  1, 'after blocking, other people''s reports are untouched');
select is(
  (select array_agg(n.id order by n.id) from public.nearby_sightings(40.127, -73.987654, 5000) n),
  array['e2e2e2e2-0000-0000-0000-00000000000c'::uuid],
  'after blocking, nearby_sightings leaves the blocked user''s report out');
select is(
  (select string_agg(body, ' | ') from public.sighting_updates
    where sighting_id = 'e2e2e2e2-0000-0000-0000-00000000000c' and type = 'comment'),
  'from someone else',
  'after blocking, the blocked user''s comment is hidden and others remain');
reset role;

-- Blocking is one way: the blocked user still sees the viewer's world.
select set_config('request.jwt.claim.sub', 'e1e1e1e1-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims',
  '{"sub":"e1e1e1e1-0000-0000-0000-000000000002","role":"authenticated"}', true);
set role authenticated;
select is(
  (select count(*)::int from public.sightings
    where id in ('e2e2e2e2-0000-0000-0000-00000000000b', 'e2e2e2e2-0000-0000-0000-00000000000c')),
  2, 'the blocked user is unaffected: blocking hides content from the blocker only');
reset role;

-- Moderators keep seeing reports even when they have blocked the author, so
-- the moderation queue still works.
insert into public.user_blocks (blocker_id, blocked_id)
values ('e1e1e1e1-0000-0000-0000-000000000004', 'e1e1e1e1-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub', 'e1e1e1e1-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claims',
  '{"sub":"e1e1e1e1-0000-0000-0000-000000000004","role":"authenticated"}', true);
set role authenticated;
select is(
  (select count(*)::int from public.sightings
    where id = 'e2e2e2e2-0000-0000-0000-00000000000b'),
  1, 'a moderator still sees a reported user''s report after blocking them');
reset role;

-- Unblocking restores everything.
select set_config('request.jwt.claim.sub', 'e1e1e1e1-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims',
  '{"sub":"e1e1e1e1-0000-0000-0000-000000000001","role":"authenticated"}', true);
set role authenticated;
delete from public.user_blocks
 where blocker_id = 'e1e1e1e1-0000-0000-0000-000000000001'
   and blocked_id = 'e1e1e1e1-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.sightings
    where id in ('e2e2e2e2-0000-0000-0000-00000000000b', 'e2e2e2e2-0000-0000-0000-00000000000c')),
  2, 'after unblocking, both reports are visible again');
select is(
  (select count(*)::int from public.nearby_sightings(40.127, -73.987654, 5000)),
  2, 'after unblocking, nearby_sightings returns both again');

-- ═════════════════════ nearby_sightings privacy ═════════════════════════════
-- sB's precise point is (40.123456, -73.987654); its coarse point is
-- (40.123, -73.988), about 59 m away. Standing exactly on the precise point
-- must NOT report distance 0.

select ok(
  (select n.distance_m from public.nearby_sightings(40.123456, -73.987654, 1000) n
    where n.id = 'e2e2e2e2-0000-0000-0000-00000000000b') > 20,
  'searching from the exact spot does not reveal distance ~0 to the precise point');

select ok(
  (select abs(n.distance_m - st_distance(
            st_setsrid(st_makepoint(-73.988, 40.123), 4326)::geography,
            st_setsrid(st_makepoint(-73.987654, 40.123456), 4326)::geography))
     from public.nearby_sightings(40.123456, -73.987654, 1000) n
    where n.id = 'e2e2e2e2-0000-0000-0000-00000000000b') < 0.5,
  'the returned distance is the distance to the COARSE point');

-- A second, different origin: still the distance to the coarse point, so
-- however many origins are tried they only ever pin down the rounded position.
select ok(
  (select abs(n.distance_m - st_distance(
            st_setsrid(st_makepoint(-73.988, 40.123), 4326)::geography,
            st_setsrid(st_makepoint(-73.99, 40.125), 4326)::geography))
     from public.nearby_sightings(40.125, -73.99, 1000) n
    where n.id = 'e2e2e2e2-0000-0000-0000-00000000000b') < 0.5,
  'a different origin also yields the distance to the coarse point');

select is(
  (select round(n.lat::numeric, 6)::text || ',' || round(n.lng::numeric, 6)::text
     from public.nearby_sightings(40.123456, -73.987654, 1000) n
    where n.id = 'e2e2e2e2-0000-0000-0000-00000000000b'),
  '40.123000,-73.988000',
  'returned coordinates are still rounded to 3 decimals');

-- The radius is judged on the coarse point too: a 30 m radius around the exact
-- spot used to match (precise distance 0) and now must not (coarse ~59 m).
select is(
  (select count(*)::int from public.nearby_sightings(40.123456, -73.987654, 30) n
    where n.id = 'e2e2e2e2-0000-0000-0000-00000000000b'),
  0, 'a tiny radius around the exact spot no longer matches on the precise point');
select is(
  (select count(*)::int from public.nearby_sightings(40.123456, -73.987654, 100) n
    where n.id = 'e2e2e2e2-0000-0000-0000-00000000000b'),
  1, 'a radius that covers the coarse point still matches');

-- Ordering and limits still behave.
select is(
  (select array_agg(n.id order by n.distance_m) from public.nearby_sightings(40.123456, -73.987654, 5000) n),
  array['e2e2e2e2-0000-0000-0000-00000000000b'::uuid, 'e2e2e2e2-0000-0000-0000-00000000000c'::uuid],
  'results are ordered nearest first');
reset role;

select * from finish();
rollback;
