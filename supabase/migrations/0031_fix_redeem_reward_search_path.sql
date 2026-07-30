-- ============================================================================
-- Guardians — 0031_fix_redeem_reward_search_path
--
-- PRODUCTION BUG (surfaced by the new pgTAP redeem_guard_test.sql):
-- redeem_reward() mints its redemption code with gen_random_bytes(), which
-- lives in the `extensions` schema on Supabase (pgcrypto). The function pins
-- `search_path = public, pg_temp`, so the call never resolved — every
-- redemption raised "function gen_random_bytes(integer) does not exist".
--
-- Widen the pinned path to include `extensions`. No body changes; the column
-- grants and revoke/grant surface from 0007/0011 are unaffected.
-- ============================================================================

alter function public.redeem_reward(uuid) set search_path = public, pg_temp, extensions;
