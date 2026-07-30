-- pgTAP tests for AI-M2 moderation (migration 0020): the ai_moderate_content
-- hide+enqueue RPC. Mirrors lifecycle_test.sql's style. Guards the invariants
-- that matter for the ai-safety-agent charter:
--   * a CONFIDENT 'violation' HIDES the target AND enqueues an AI-attributed
--     (reporter_id IS NULL) open report;
--   * a 'borderline' verdict enqueues but does NOT hide;
--   * an 'ok'/unknown verdict is a no-op;
--   * the RPC never deletes;
--   * the grant is service_role-only — public/anon/authenticated cannot execute.
--
-- Also covers get_report_velocity_flags (AI-M2 #12, same migration): the
-- read-only points-farming velocity flag is is_moderator()-gated (anon has no
-- grant; a non-moderator caller is rejected in the body) and correctly flags a
-- burst reporter for review — it never blocks or hides anything by design.
--
-- Run with:  supabase test db

begin;
select plan(16);

-- ── Fixtures: one profile (reporter), one sighting, one comment ───────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'reporter@example.test')
  on conflict do nothing;
-- handle_new_user() mirrors auth.users into profiles; insert directly in case the
-- trigger isn't firing in the test transaction.
insert into public.profiles (id, username) values
  ('11111111-1111-1111-1111-111111111111', 'reporter')
  on conflict do nothing;

-- lat/lng are GENERATED from location (0001) — insert the geography only.
insert into public.sightings (id, reporter_id, location, status)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography,
  'spotted'
);

insert into public.sighting_updates (id, sighting_id, author_id, type, body)
values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'comment', 'a comment'
);

-- ── 'ok'/unknown verdict is a no-op: nothing hidden, nothing enqueued ─────────
select public.ai_moderate_content('sighting', '22222222-2222-2222-2222-222222222222', 'ok', null, null);
select is(
  (select is_hidden from public.sightings where id = '22222222-2222-2222-2222-222222222222'),
  false, 'ok verdict does not hide the sighting');
select is(
  (select count(*)::int from public.abuse_reports
     where target_id = '22222222-2222-2222-2222-222222222222'),
  0, 'ok verdict enqueues nothing');

-- ── 'borderline' enqueues an AI-attributed report but does NOT hide ───────────
select public.ai_moderate_content('sighting', '22222222-2222-2222-2222-222222222222', 'borderline', array['off-topic'], 'not a cat');
select is(
  (select is_hidden from public.sightings where id = '22222222-2222-2222-2222-222222222222'),
  false, 'borderline verdict does NOT hide');
select is(
  (select count(*)::int from public.abuse_reports
     where target_id = '22222222-2222-2222-2222-222222222222'
       and reporter_id is null and status = 'open'),
  1, 'borderline verdict enqueues one AI-attributed open report');

-- ── 'violation' on the SAME target refreshes (not duplicates) and now hides ───
select public.ai_moderate_content('sighting', '22222222-2222-2222-2222-222222222222', 'violation', array['nsfw'], 'explicit');
select is(
  (select is_hidden from public.sightings where id = '22222222-2222-2222-2222-222222222222'),
  true, 'violation verdict hides the sighting');
select is(
  (select count(*)::int from public.abuse_reports
     where target_id = '22222222-2222-2222-2222-222222222222' and reporter_id is null),
  1, 'repeat AI flag refreshes the existing report, does not duplicate');

-- ── violation on a comment hides the comment + enqueues ───────────────────────
select public.ai_moderate_content('comment', '33333333-3333-3333-3333-333333333333', 'violation', array['harassment'], 'toxic');
select is(
  (select is_hidden from public.sighting_updates where id = '33333333-3333-3333-3333-333333333333'),
  true, 'violation verdict hides the comment');

-- ── Never deletes: the flagged rows still exist ───────────────────────────────
select is(
  (select count(*)::int from public.sightings where id = '22222222-2222-2222-2222-222222222222'),
  1, 'the hidden sighting is NOT deleted');

-- ── Grant surface: service_role only; public/anon/authenticated cannot execute ─
select ok(
  not has_function_privilege('anon', 'public.ai_moderate_content(text, uuid, text, text[], text)', 'execute'),
  'anon cannot execute ai_moderate_content');
select ok(
  not has_function_privilege('authenticated', 'public.ai_moderate_content(text, uuid, text, text[], text)', 'execute'),
  'authenticated cannot execute ai_moderate_content');
select ok(
  has_function_privilege('service_role', 'public.ai_moderate_content(text, uuid, text, text[], text)', 'execute'),
  'service_role CAN execute ai_moderate_content');

-- ══ get_report_velocity_flags (AI-M2 #12, scoped velocity heuristic) ══════════

-- Grant surface: anon has no execute; authenticated does (the body enforces
-- is_moderator(), matching moderate_content's 0012/0016 pattern).
select ok(
  not has_function_privilege('anon', 'public.get_report_velocity_flags(int, int, int)', 'execute'),
  'anon cannot execute get_report_velocity_flags');
select ok(
  has_function_privilege('authenticated', 'public.get_report_velocity_flags(int, int, int)', 'execute'),
  'authenticated can reach get_report_velocity_flags (body-gated)');

-- Body gate: with no session (auth.uid() is null → not a moderator), rejected.
select throws_ok(
  'select * from public.get_report_velocity_flags()',
  'Moderators only',
  'non-moderator caller is rejected by the body gate');

-- ── Burst fixture: 5 more sightings for the reporter (6 total, ≥ threshold 5).
-- Inserted BEFORE simulating a session so auth.uid() is null and the 0011
-- anti-flood trigger no-ops (it only limits a caller's own rows).
insert into public.sightings (reporter_id, location, status)
select
  '11111111-1111-1111-1111-111111111111',
  st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography,
  'spotted'
from generate_series(1, 5);

-- Simulate a signed-in moderator: promote the fixture user and stamp their id
-- into the request JWT GUCs that auth.uid() reads.
update public.profiles set is_moderator = true
 where id = '11111111-1111-1111-1111-111111111111';
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true);

-- The burst reporter is flagged for review (6 sightings inside the window)…
select is(
  (select f.sighting_count from public.get_report_velocity_flags(60, 5, 20) f
    where f.user_id = '11111111-1111-1111-1111-111111111111'),
  6::bigint, 'burst reporter is flagged with their sighting count');

-- …and the flag is review-only: nothing was hidden and nothing was enqueued by
-- calling it (the heuristic never blocks, hides, or reports on its own).
select is(
  (select count(*)::int from public.sightings
    where reporter_id = '11111111-1111-1111-1111-111111111111' and is_hidden = false),
  5, 'velocity flag hides nothing (only the earlier violation-hidden row is hidden)');

select * from finish();
rollback;
