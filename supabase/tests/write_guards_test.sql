-- pgTAP tests for client write guards (migrations 0004, 0011, 0012, 0013):
-- the anti-cheat invariants of the gamification economy and the moderation
-- gate. Mirrors ai_moderation_test.sql's style. Guards:
--   * score columns (profiles.points / kibble_balance, sightings.status) are
--     NOT client-writable — 0004 revoked table UPDATE and re-granted only
--     specific columns, so touching a guarded column fails at plan time;
--   * award_points / award_badges are not executable by clients (0013 closed
--     the unlimited-points exploit);
--   * moderate_content is granted to authenticated but body-gated by
--     is_moderator() (0012): strangers are rejected, moderators can hide.
--
-- Run with:  supabase test db

begin;
select plan(10);

-- ── Fixtures: one user + one sighting ────────────────────────────────────────
insert into auth.users (id, email) values
  ('ccccccc1-0000-0000-0000-000000000001', 'guards@example.test')
  on conflict do nothing;
insert into public.profiles (id, username) values
  ('ccccccc1-0000-0000-0000-000000000001', 'wg_user')
  on conflict do nothing;

-- lat/lng are GENERATED from location (0001) — insert the geography only.
insert into public.sightings (id, reporter_id, location, status)
values (
  'ccccccc2-0000-0000-0000-000000000001',
  'ccccccc1-0000-0000-0000-000000000001',
  st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography,
  'spotted'
);

-- ── Score/status columns reject direct client UPDATE (column GRANTs, 0004) ──
set role authenticated;
select throws_matching(
  'update public.profiles set points = points + 1000',
  'permission denied',
  'direct UPDATE of profiles.points is denied');
select throws_matching(
  'update public.profiles set kibble_balance = 999999',
  'permission denied',
  'direct UPDATE of profiles.kibble_balance is denied');
select throws_matching(
  'update public.sightings set status = ''safe''',
  'permission denied',
  'direct UPDATE of sightings.status is denied');

-- ── Gamification RPCs are not client-executable (0013) ──────────────────────
select throws_matching(
  'select public.award_points(''ccccccc1-0000-0000-0000-000000000001''::uuid, 1000, ''hack'', null)',
  'permission denied',
  'authenticated cannot execute award_points');
select throws_matching(
  'select public.award_badges(''ccccccc1-0000-0000-0000-000000000001''::uuid)',
  'permission denied',
  'authenticated cannot execute award_badges');
reset role;

-- ── moderate_content grant surface (granted to authenticated, body-gated) ───
select ok(
  not has_function_privilege('anon', 'public.moderate_content(text, uuid, boolean)', 'execute'),
  'anon cannot execute moderate_content');
select ok(
  has_function_privilege('authenticated', 'public.moderate_content(text, uuid, boolean)', 'execute'),
  'authenticated can reach moderate_content (body-gated)');

-- ── Body gate: no session → rejected ─────────────────────────────────────────
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  'select public.moderate_content(''sighting'', ''ccccccc2-0000-0000-0000-000000000001'', true)',
  'Moderators only',
  'caller with no session is rejected by the is_moderator gate');

-- ── Body gate: signed-in non-moderator → rejected ────────────────────────────
select set_config('request.jwt.claim.sub', 'ccccccc1-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims',
  '{"sub":"ccccccc1-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  'select public.moderate_content(''sighting'', ''ccccccc2-0000-0000-0000-000000000001'', true)',
  'Moderators only',
  'non-moderator user is rejected by the is_moderator gate');

-- ── Gate opens for a real moderator: the sighting is hidden ──────────────────
update public.profiles set is_moderator = true
 where id = 'ccccccc1-0000-0000-0000-000000000001';
select public.moderate_content('sighting', 'ccccccc2-0000-0000-0000-000000000001', true);
select is(
  (select is_hidden from public.sightings where id = 'ccccccc2-0000-0000-0000-000000000001'),
  true, 'moderator can hide the sighting (gate opens)');

select * from finish();
rollback;
