-- ============================================================================
-- Guardians — 0028b_owner_scoped_storage_select
--
-- Corrective follow-up to 0028. Applied to the live project on 2026-07-26
-- (ledger version 20260726202917) but never checked in; this file restores
-- git/prod parity. Content is verbatim from the live migration ledger.
--
-- Dropping ALL SELECT policies on storage.objects (0028) blocked anonymous
-- enumeration but also broke owner delete/update: the Storage API resolves the
-- row (SELECT) before mutating it, so with no SELECT policy an owner got 403 on
-- their own file. Restore visibility scoped to the OWNER only — anonymous and
-- cross-user enumeration stay blocked, and public object URLs are unaffected
-- either way. supabase/scripts/schema_assertions.sql asserts this policy exists.
-- ============================================================================

create policy "owners read their own files"
  on storage.objects for select to authenticated
  using (owner = (select auth.uid())
         and bucket_id = any (array['cat-photos'::text, 'avatars'::text]));
