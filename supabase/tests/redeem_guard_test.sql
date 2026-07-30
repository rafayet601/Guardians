-- pgTAP tests for redeem_reward guards (migrations 0007 + 0011): the
-- double-spend / abuse protections on the ONLY path that spends Kibble.
-- Mirrors ai_moderation_test.sql's style. Guards:
--   * insufficient balance is rejected;
--   * a successful redeem atomically debits the wallet and issues a code;
--   * the 5-second per-user cooldown rejects an immediate second redeem
--     (anti-spam added in 0011 alongside the FOR UPDATE profile lock);
--   * the cooldown is per-user, not global — another user can still redeem;
--   * an inactive offer is rejected;
--   * grant surface: anon cannot execute, authenticated can.
--
-- Note: the FOR UPDATE row lock itself (concurrent same-user double-spend)
-- can't be exercised single-threaded; the cooldown is its observable
-- single-threaded proxy and is what we assert here.
--
-- Run with:  supabase test db

begin;
select plan(9);

-- ── Fixtures: three users (broke / funded / funded), one brand, three offers ─
insert into auth.users (id, email) values
  ('ddddddd1-0000-0000-0000-000000000001', 'broke@example.test'),
  ('ddddddd2-0000-0000-0000-000000000002', 'funded1@example.test'),
  ('ddddddd3-0000-0000-0000-000000000003', 'funded2@example.test')
  on conflict do nothing;
-- handle_new_user() pre-creates profiles on the auth.users insert above, so
-- the kibble_balance values here would be swallowed by ON CONFLICT — set them
-- explicitly instead.
insert into public.profiles (id, username, kibble_balance) values
  ('ddddddd1-0000-0000-0000-000000000001', 'rg_broke', 0),
  ('ddddddd2-0000-0000-0000-000000000002', 'rg_funded1', 500),
  ('ddddddd3-0000-0000-0000-000000000003', 'rg_funded2', 500)
  on conflict do nothing;
update public.profiles set kibble_balance = 500
 where id in ('ddddddd2-0000-0000-0000-000000000002', 'ddddddd3-0000-0000-0000-000000000003');

insert into public.reward_brands (id, name) values
  ('ddddddd4-0000-0000-0000-000000000004', 'Test Brand')
  on conflict do nothing;

-- Offer A: affordable, repeatable (once_per_user false so the SECOND redeem
-- hits the cooldown, not the once-per-user guard).
insert into public.reward_offers (id, brand_id, title, cost_kibble, once_per_user) values
  ('ddddddd5-0000-0000-0000-000000000005', 'ddddddd4-0000-0000-0000-000000000004', 'Offer A', 100, false),
  ('ddddddd6-0000-0000-0000-000000000006', 'ddddddd4-0000-0000-0000-000000000004', 'Offer B', 50, false)
  on conflict do nothing;
insert into public.reward_offers (id, brand_id, title, cost_kibble, is_active) values
  ('ddddddd7-0000-0000-0000-000000000007', 'ddddddd4-0000-0000-0000-000000000004', 'Offer C', 10, false)
  on conflict do nothing;

-- ── Insufficient balance is rejected ─────────────────────────────────────────
select set_config('request.jwt.claim.sub', 'ddddddd1-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims',
  '{"sub":"ddddddd1-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_matching(
  'select public.redeem_reward(''ddddddd5-0000-0000-0000-000000000005'')',
  'Not enough Kibble',
  'redeem with insufficient balance fails');

-- ── Fund the user → redeem succeeds and debits atomically ───────────────────
update public.profiles set kibble_balance = 500
 where id = 'ddddddd1-0000-0000-0000-000000000001';
select public.redeem_reward('ddddddd5-0000-0000-0000-000000000005');

select is(
  (select count(*)::int from public.reward_redemptions
    where user_id = 'ddddddd1-0000-0000-0000-000000000001'
      and offer_id = 'ddddddd5-0000-0000-0000-000000000005'),
  1, 'successful redeem issues exactly one redemption');
select is(
  (select kibble_balance from public.profiles where id = 'ddddddd1-0000-0000-0000-000000000001'),
  400, 'balance is debited by the offer cost');

-- ── 5s cooldown: an immediate second redeem (different offer) is rejected ────
select throws_ok(
  'select public.redeem_reward(''ddddddd6-0000-0000-0000-000000000006'')',
  'Please wait a few seconds between redemptions',
  'immediate second redeem hits the per-user cooldown');

-- ── Cooldown is per-user: another funded user can still redeem right away ────
select set_config('request.jwt.claim.sub', 'ddddddd2-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims',
  '{"sub":"ddddddd2-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.redeem_reward('ddddddd6-0000-0000-0000-000000000006');

select is(
  (select count(*)::int from public.reward_redemptions
    where user_id = 'ddddddd2-0000-0000-0000-000000000002'
      and offer_id = 'ddddddd6-0000-0000-0000-000000000006'),
  1, 'a different user is unaffected by the first user''s cooldown');
select is(
  (select kibble_balance from public.profiles where id = 'ddddddd2-0000-0000-0000-000000000002'),
  450, 'second user''s balance is debited correctly');

-- ── Inactive offer is rejected (user with a clean cooldown slate) ────────────
select set_config('request.jwt.claim.sub', 'ddddddd3-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims',
  '{"sub":"ddddddd3-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  'select public.redeem_reward(''ddddddd7-0000-0000-0000-000000000007'')',
  'This reward is no longer available',
  'inactive offer is rejected');

-- ── Grant surface: anon cannot execute; authenticated can ────────────────────
select ok(
  not has_function_privilege('anon', 'public.redeem_reward(uuid)', 'execute'),
  'anon cannot execute redeem_reward');
select ok(
  has_function_privilege('authenticated', 'public.redeem_reward(uuid)', 'execute'),
  'authenticated can execute redeem_reward');

select * from finish();
rollback;
