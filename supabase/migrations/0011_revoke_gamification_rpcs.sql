-- ============================================================================
-- Guardians — 0011_revoke_gamification_rpcs
-- Security patch to revoke public execution privileges on internal gamification
-- functions that were mistakenly left accessible to clients.
-- ============================================================================

-- By default, PostgreSQL grants EXECUTE on new functions to PUBLIC.
-- We must revoke this for SECURITY DEFINER functions that bypass RLS
-- and should only be called internally by triggers or other functions.

revoke execute on function public.award_points(uuid, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.award_badges(uuid) from public, anon, authenticated;
