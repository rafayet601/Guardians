-- 0044 — The adopter-screening RPCs are for signed-in users only.
--
-- 0032 revoked EXECUTE from PUBLIC and granted it to authenticated, but
-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon directly, and a revoke from PUBLIC does not touch that grant. So
-- get_my_screening, submit_adopter_screening and is_adopter_cleared stayed
-- callable without signing in (Supabase advisor 0028). Each checks
-- auth.uid() itself, so this closes a door that should never have been
-- open rather than a known leak.
--
-- Nothing signed-out depends on them: the app calls them only with a
-- session, and the adoption RPCs that call is_adopter_cleared run as the
-- function owner.

revoke execute on function public.get_my_screening()               from anon;
revoke execute on function public.submit_adopter_screening(jsonb)  from anon;
revoke execute on function public.is_adopter_cleared(uuid)         from anon;
