-- pgTAP tests for location privacy (migration 0009): get_sighting_detail must
-- return PRECISE coordinates + street address ONLY to the reporter or the
-- assigned guardian (claimed_by); everyone else gets coordinates rounded to
-- ~3 decimals (~110m), a null address, and is_precise = false. Mirrors
-- rag_kb_test.sql / ai_moderation_test.sql's style. Guards the app's core
-- safety invariant: the map can't be used to enumerate exact cat locations.
--
-- Run with:  supabase test db

begin;
select plan(10);

-- ── Fixtures: reporter, stranger, guardian + one precisely-located sighting ──
insert into auth.users (id, email) values
  ('aaaaaaa1-0000-0000-0000-000000000001', 'reporter@example.test'),
  ('aaaaaaa2-0000-0000-0000-000000000002', 'stranger@example.test'),
  ('aaaaaaa3-0000-0000-0000-000000000003', 'guardian@example.test')
  on conflict do nothing;
insert into public.profiles (id, username) values
  ('aaaaaaa1-0000-0000-0000-000000000001', 'lp_reporter'),
  ('aaaaaaa2-0000-0000-0000-000000000002', 'lp_stranger'),
  ('aaaaaaa3-0000-0000-0000-000000000003', 'lp_guardian')
  on conflict do nothing;

-- lat/lng are GENERATED from location (0001) — insert the geography only.
insert into public.sightings (id, reporter_id, location, status, address)
values (
  'bbbbbbb1-0000-0000-0000-000000000001',
  'aaaaaaa1-0000-0000-0000-000000000001',
  st_setsrid(st_makepoint(-73.987654, 40.123456), 4326)::geography,
  'spotted',
  '123 Test St'
);

-- ── Reporter sees the exact pin + address ────────────────────────────────────
select set_config('request.jwt.claim.sub', 'aaaaaaa1-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaa1-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'is_precise')::boolean,
  true, 'reporter gets is_precise = true');
select is(
  (public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'lat')::double precision,
  40.123456::double precision, 'reporter gets the exact latitude');
select is(
  public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'address',
  '123 Test St', 'reporter gets the street address');

-- ── Stranger gets a coarsened position, no address, is_precise = false ───────
select set_config('request.jwt.claim.sub', 'aaaaaaa2-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaa2-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(
  (public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'is_precise')::boolean,
  false, 'stranger gets is_precise = false');
select is(
  (public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'lat')::double precision,
  40.123::double precision, 'stranger latitude is rounded to 3 decimals (~110m), never exact');
select ok(
  public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'address' is null,
  'stranger never sees the street address');

-- ── Assigned guardian (claimed_by) is coordinating the rescue → precise ──────
update public.sightings set claimed_by = 'aaaaaaa3-0000-0000-0000-000000000003'
 where id = 'bbbbbbb1-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', 'aaaaaaa3-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaa3-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is(
  (public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'is_precise')::boolean,
  true, 'assigned guardian gets is_precise = true');
select is(
  (public.get_sighting_detail('bbbbbbb1-0000-0000-0000-000000000001') ->> 'lat')::double precision,
  40.123456::double precision, 'assigned guardian gets the exact latitude');

-- ── Grant surface: anon cannot execute; authenticated can ────────────────────
select ok(
  not has_function_privilege('anon', 'public.get_sighting_detail(uuid)', 'execute'),
  'anon cannot execute get_sighting_detail');
select ok(
  has_function_privilege('authenticated', 'public.get_sighting_detail(uuid)', 'execute'),
  'authenticated can execute get_sighting_detail');

select * from finish();
rollback;
