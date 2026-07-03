-- pgTAP tests for Guardians' load-bearing pure SQL logic: the gamification level
-- curve and the rescue-lifecycle state machine. These are deterministic and
-- need no auth simulation, so they make a fast regression net that fails if a
-- future migration changes the economy or the allowed transitions.
--
-- Run with:  supabase test db
-- (Supabase bundles pgTAP; this file is picked up from supabase/tests/.)

begin;
select plan(12);

-- ── level_for_points: escalating curve (lvl1=0, lvl2=50, lvl3=200, …) ──────────
select is(public.level_for_points(0), 1, 'level 1 at 0 points');
select is(public.level_for_points(49), 1, 'still level 1 just below 50');
select is(public.level_for_points(50), 2, 'level 2 at 50 points');
select is(public.level_for_points(200), 3, 'level 3 at 200 points');
select is(public.level_for_points(-10), 1, 'never drops below level 1');

-- ── is_valid_transition: the spotted→…→adopted lifecycle guard ────────────────
select ok(not public.is_valid_transition('spotted', 'claimed'), 'spotted->claimed only via claim_sighting');
select ok(public.is_valid_transition('claimed', 'in_rescue'), 'claimed->in_rescue allowed');
select ok(public.is_valid_transition('in_rescue', 'safe'), 'in_rescue->safe allowed');
select ok(public.is_valid_transition('safe', 'available'), 'safe->available allowed');
select ok(not public.is_valid_transition('available', 'adopted'), 'available->adopted only via approve_adoption');
select ok(not public.is_valid_transition('spotted', 'spotted'), 'no self-transition');
select ok(public.is_valid_transition('claimed', 'archived'), 'open states can be archived');

select * from finish();
rollback;
