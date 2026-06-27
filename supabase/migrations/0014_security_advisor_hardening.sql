-- ============================================================================
-- Guardians — 0014_security_advisor_hardening
-- Fixes from the Supabase database security advisor (applied via MCP 2026-06-23).
-- ============================================================================

-- 1) Pin search_path on the three functions flagged as role-mutable.
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.level_for_points(integer) set search_path = public, pg_temp;
alter function public.is_valid_transition(public.cat_status, public.cat_status)
  set search_path = public, pg_temp;

-- 2) Trigger-only functions are never meant to be reachable via the REST `/rpc`
--    endpoint. Revoke EXECUTE from every client role — triggers still fire (they
--    run as the table owner, independent of the invoker's EXECUTE grant).
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.on_sighting_created() from public, anon, authenticated;
revoke execute on function public.enforce_insert_rate_limit() from public, anon, authenticated;
revoke execute on function public.enforce_photo_cap() from public, anon, authenticated;

-- 3) The genuine client RPCs are intentionally callable by `authenticated` (each
--    guards on auth.uid() internally). They never need `anon`, so revoke it to
--    shrink the attack surface and clear the anon_security_definer advisor.
revoke execute on function public.create_sighting(double precision, double precision, text, text, public.cat_temperament, text, boolean, boolean, text) from anon;
revoke execute on function public.claim_sighting(uuid) from anon;
revoke execute on function public.update_sighting_status(uuid, public.cat_status, text) from anon;
revoke execute on function public.express_adoption_interest(uuid, text) from anon;
revoke execute on function public.approve_adoption(uuid) from anon;
revoke execute on function public.withdraw_adoption_interest(uuid) from anon;
revoke execute on function public.get_sighting_detail(uuid) from anon;
revoke execute on function public.nearby_sightings(double precision, double precision, double precision, public.cat_status[], integer) from anon;
revoke execute on function public.redeem_reward(uuid) from anon;
revoke execute on function public.upsert_push_token(text, double precision, double precision) from anon;
revoke execute on function public.report_content(text, uuid, text) from anon;
revoke execute on function public.moderate_content(text, uuid, boolean) from anon;
revoke execute on function public.is_moderator() from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.grant_role(uuid, text, boolean) from anon;
