-- pgTAP tests for AI-M5 #8 push ranking (migration 0022): rank_push_recipients.
-- Mirrors lifecycle_test.sql / ai_moderation_test.sql's style. Guards the
-- invariants that matter for the ai-analytics-agent charter:
--   * 'control' and 'ranked' return the SAME recipient set — no exclusion;
--     ranking REORDORS, it never drops a recipient.
--   * 'ranked' returns non-null scores and ranks 1..N (dense, 1-based);
--   * 'control' returns null scores AND null ranks (unranked);
--   * a user with strong rescue history scores >= a user with none (formula
--     direction sanity — the whole point of ranking);
--   * the reporter is excluded (matches tokens_near);
--   * the grant is service_role-only — public/anon/authenticated cannot execute.
--
-- Run with:  supabase test db

begin;
select plan(12);

-- ── Fixtures: a reporter + two guardians near an urgent sighting ─────────────
--   reporter  : excluded from recipients (matches tokens_near). Has a token
--               at the sighting so we can assert exclusion is by user, not geo.
--   strong    : is_guardian, rescues_count=10, level=5, plus a recent
--               sighting_claimed event and a correlated urgent_push_sent →
--               sighting_claimed latency pair (10 min) on a prior sighting.
--   newbie    : no rescue history, no analytics events.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'reporter@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'strong@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'newbie@example.test')
  on conflict do nothing;

-- handle_new_user() mirrors auth.users into profiles; insert directly in case
-- the trigger isn't firing in the test transaction.
insert into public.profiles (id, username, is_guardian, rescues_count, level) values
  ('11111111-1111-1111-1111-111111111111', 'reporter', false, 0, 1),
  ('22222222-2222-2222-2222-222222222222', 'strong',   true,  10, 5),
  ('33333333-3333-3333-3333-333333333333', 'newbie',   false, 0, 1)
  on conflict do nothing;

-- Push tokens: reporter at the sighting (must be excluded by user), strong +
-- newbie ~110m away (within the 8km radius). urgent_opt_in defaults true.
insert into public.device_push_tokens (user_id, token, last_known_location, notify_radius_m) values
  ('11111111-1111-1111-1111-111111111111', 'tok_reporter',
   st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography, 8000),
  ('22222222-2222-2222-2222-222222222222', 'tok_strong',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography, 8000),
  ('33333333-3333-3333-3333-333333333333', 'tok_newbie',
   st_setsrid(st_makepoint(-73.0, 40.001), 4326)::geography, 8000)
  on conflict do nothing;

-- The urgent sighting being ranked.
insert into public.sightings (id, reporter_id, location, status, needs_urgent_help) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   st_setsrid(st_makepoint(-73.0, 40.0), 4326)::geography,
   'spotted', true)
  on conflict do nothing;

-- A prior urgent push + the strong guardian's claim on it 10 min later —
-- populates the time-to-claim latency signal (avg_urgent_claim_min = 10 →
-- latency_bonus 0.5) and the recent-claim activity signal (within 7 days).
insert into public.analytics_events (user_id, event, props, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'urgent_push_sent',
   '{"sighting_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","variant":"ranked","recipient_count":1,"top_scores":[],"fallback":false}'::jsonb,
   now() - interval '1 day'),
  ('22222222-2222-2222-2222-222222222222', 'sighting_claimed',
   '{"id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}'::jsonb,
   now() - interval '1 day' + interval '10 minutes');

-- ══ Same-set invariant: control and ranked never exclude anyone ══════════════
select set_eq(
  $$select token from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'control')$$,
  $$select token from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked')$$,
  'control and ranked return the same recipient set (no exclusion)');

-- Both variants include exactly the two nearby guardians (reporter excluded).
select is(
  (select count(*)::int from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked')),
  2, 'ranked returns the two nearby guardians (reporter excluded)');

-- Reporter is never in the recipient set (excluded by user, not by geo — their
-- token is at the sighting).
select ok(
  not exists (
    select 1 from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked') r
    where r.user_id = '11111111-1111-1111-1111-111111111111'
  ),
  'reporter is excluded from recipients');

-- ══ 'ranked' variant: non-null scores + dense 1..N ranks ══════════════════════
select is(
  (select count(*)::int from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked')
    where score is null),
  0, 'ranked variant has no null scores');

select is(
  (select array_agg(r.rank order by r.rank)
     from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked') r),
  array[1, 2]::int[],
  'ranked ranks are dense 1..N');

-- The strong guardian (rescues_count=10, is_guardian, recent claim) outranks
-- the newbie → rank 1.
select is(
  (select r.token from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked') r
    where r.rank = 1),
  'tok_strong',
  'rank 1 is the strong guardian (highest score)');

-- ══ 'control' variant: null scores AND null ranks (unranked) ═════════════════
select is(
  (select count(*)::int from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'control')
    where score is not null),
  0, 'control variant has null scores');

select is(
  (select count(*)::int from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'control')
    where rank is not null),
  0, 'control variant has null ranks (unranked)');

-- ══ Formula direction: strong rescue history scores >= none ══════════════════
select is(
  (select r.score from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked') r
    where r.user_id = '22222222-2222-2222-2222-222222222222')
  >=
  (select r.score from public.rank_push_recipients('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ranked') r
    where r.user_id = '33333333-3333-3333-3333-333333333333'),
  true,
  'strong rescue history scores >= none');

-- ══ Grant surface: service_role only (like ai_moderate_content 0020) ═════════
select ok(
  not has_function_privilege('anon', 'public.rank_push_recipients(uuid, text)', 'execute'),
  'anon cannot execute rank_push_recipients');
select ok(
  not has_function_privilege('authenticated', 'public.rank_push_recipients(uuid, text)', 'execute'),
  'authenticated cannot execute rank_push_recipients');
select ok(
  has_function_privilege('service_role', 'public.rank_push_recipients(uuid, text)', 'execute'),
  'service_role CAN execute rank_push_recipients');

select * from finish();
rollback;
