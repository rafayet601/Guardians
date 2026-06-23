-- ============================================================================
-- Guardians — 0013_revoke_gamification_rpcs
-- (Renumbered from a colliding 0011_* so the migration sequence stays unique.)
--
-- CRITICAL privilege-escalation fix. award_points() and award_badges() are
-- SECURITY DEFINER (they bypass RLS to write points/level/Kibble/badges) but
-- were left with PostgreSQL's default PUBLIC execute grant. That let ANY
-- authenticated client call award_points(<self>, 999999, ...) directly to inject
-- unlimited points and Kibble (which is spendable on real brand rewards).
--
-- Revoke client execute so these are callable only internally — by triggers and
-- the other SECURITY DEFINER RPCs, which run as the function owner and are
-- unaffected by this revoke.
-- ============================================================================

revoke execute on function public.award_points(uuid, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.award_badges(uuid) from public, anon, authenticated;
