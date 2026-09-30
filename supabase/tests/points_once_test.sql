-- pgTAP tests for once-per-cat point awards (migration 0037): claim and rescue
-- points are paid once per person per cat. Before this, release + re-claim paid
-- +15 every lap and safe <-> available paid +50 and a rescue count every lap,
-- which let one person mint spendable Kibble with no rescues behind it.
-- Also guards the behaviour that must NOT change: a different cat still pays,
-- and a different Guardian who takes over a released cat earns their own points.
--
-- Run with:  supabase test db

begin;
select plan(14);

-- ── Fixtures: a reporter, two guardians, two cats ────────────────────────────
insert into auth.users (id, email) values
  ('f1f1f1f1-0000-0000-0000-000000000001', 'reporter@example.test'),
  ('f1f1f1f1-0000-0000-0000-000000000002', 'guardian-a@example.test'),
  ('f1f1f1f1-0000-0000-0000-000000000003', 'guardian-b@example.test')
  on conflict do nothing;
insert into public.profiles (id, username) values
  ('f1f1f1f1-0000-0000-0000-000000000001', 'po_reporter'),
  ('f1f1f1f1-0000-0000-0000-000000000002', 'po_guardian_a'),
  ('f1f1f1f1-0000-0000-0000-000000000003', 'po_guardian_b')
  on conflict do nothing;

insert into public.sightings (id, reporter_id, location, status) values
  ('f2f2f2f2-0000-0000-0000-000000000001', 'f1f1f1f1-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography, 'spotted'),
  ('f2f2f2f2-0000-0000-0000-000000000002', 'f1f1f1f1-0000-0000-0000-000000000001',
   st_setsrid(st_makepoint(-73.1, 40.1), 4326)::geography, 'spotted');

-- The anti-spam limiter (0011) allows 8 timeline rows per 30 seconds per person,
-- and this test deliberately performs more transitions than a person would in
-- that window (all rows share one transaction timestamp). It is the award logic
-- under test, not the limiter, so switch that one trigger off for this
-- transaction; the rollback at the end restores it.
alter table public.sighting_updates disable trigger sighting_updates_rate;

-- Guardian A works on cat 1.
select set_config('request.jwt.claim.sub', 'f1f1f1f1-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims',
  '{"sub":"f1f1f1f1-0000-0000-0000-000000000002","role":"authenticated"}', true);

select public.claim_sighting('f2f2f2f2-0000-0000-0000-000000000001');
select is(
  (select points from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  15, 'claiming a cat pays 15');

-- Release, then claim the same cat again: no second payout.
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000001', 'spotted', 'released');
select is(
  (select status::text from public.sightings where id = 'f2f2f2f2-0000-0000-0000-000000000001'),
  'spotted', 'a released cat goes back to spotted');
select public.claim_sighting('f2f2f2f2-0000-0000-0000-000000000001');
select is(
  (select points from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  15, 'claim / release / claim does not pay again');
select is(
  (select count(*)::int from public.point_events
    where user_id = 'f1f1f1f1-0000-0000-0000-000000000002'
      and sighting_id = 'f2f2f2f2-0000-0000-0000-000000000001'
      and reason = 'Claimed a rescue'),
  1, 'exactly one claim award is recorded for the cat');

-- Complete the rescue: paid once, rescue count +1.
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000001', 'in_rescue');
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000001', 'safe');
select is(
  (select points from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  65, 'completing the rescue pays 50 on top of the claim');
select is(
  (select rescues_count from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  1, 'the rescue is counted once');

-- The safe <-> available toggle must not pay or count again.
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000001', 'available');
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000001', 'safe');
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000001', 'available');
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000001', 'safe');
select is(
  (select points from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  65, 'toggling safe / available does not pay the rescue again');
select is(
  (select rescues_count from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  1, 'toggling safe / available does not inflate the rescue count');
select is(
  (select count(*)::int from public.point_events
    where user_id = 'f1f1f1f1-0000-0000-0000-000000000002'
      and sighting_id = 'f2f2f2f2-0000-0000-0000-000000000001'
      and reason = 'Completed a rescue'),
  1, 'exactly one rescue award is recorded for the cat');
select is(
  (select kibble_balance from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  65, 'spendable Kibble follows points, so it is not inflated either');

-- A different cat still pays in full.
select public.claim_sighting('f2f2f2f2-0000-0000-0000-000000000002');
select is(
  (select points from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  80, 'a different cat still pays the claim award');

-- A different Guardian who takes over a released cat earns their own points.
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000002', 'spotted', 'released');
select set_config('request.jwt.claim.sub', 'f1f1f1f1-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims',
  '{"sub":"f1f1f1f1-0000-0000-0000-000000000003","role":"authenticated"}', true);
select public.claim_sighting('f2f2f2f2-0000-0000-0000-000000000002');
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000002', 'in_rescue');
select public.update_sighting_status('f2f2f2f2-0000-0000-0000-000000000002', 'safe');
select is(
  (select points from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000003'),
  65, 'the next Guardian earns claim + rescue points for a cat someone else released');
select is(
  (select rescues_count from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000003'),
  1, 'and gets the rescue counted');
select is(
  (select points from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
  80, 'while the first Guardian, who released it, is not paid for that cat''s rescue');

select * from finish();
rollback;
