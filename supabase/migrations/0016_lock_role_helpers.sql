-- ============================================================================
-- Guardians — 0016_lock_role_helpers
-- is_admin / is_moderator were reachable by `anon` via the default PUBLIC grant
-- (so revoking `anon` alone in 0014 was a no-op). Revoke PUBLIC and pin EXECUTE
-- to `authenticated`: the client calls is_moderator, and both are evaluated
-- inside RLS policies as the authenticated user. (applied via MCP)
-- ============================================================================
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_moderator() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_moderator() to authenticated;
