-- ============================================================================
-- Guardians — 0028_storage_listing_and_policy_merge
--
-- Closes the last two actionable advisor findings after 0027.
--
-- 1. public_bucket_allows_listing (WARN ×2) — REAL, reproduced before the fix:
--    an ANONYMOUS caller could POST /storage/v1/object/list/cat-photos and
--    enumerate every stored file. The broad `bucket_id = '<bucket>'` SELECT
--    policies on storage.objects are what enable that LIST call.
--
--    Public buckets do NOT need a SELECT policy to serve object URLs —
--    /storage/v1/object/public/<bucket>/<path> bypasses RLS. So dropping these
--    policies removes enumeration while every <img src> keeps working.
--
--    Verified non-breaking against the actual codebase: the only storage calls
--    are `upload` (INSERT policy, untouched), `getPublicUrl` (pure client-side
--    string building, no API call), and `download` in the AI edge functions —
--    which uses the SERVICE ROLE and therefore bypasses RLS entirely. There is
--    no `.list()` anywhere in src/, app/, or supabase/functions/.
--
-- 2. multiple_permissive_policies (WARN ×3) — reward_brands / reward_offers /
--    sponsored_placements each had TWO permissive SELECT policies for
--    `authenticated` ("active X are viewable" + the FOR ALL "admins manage X"),
--    so Postgres evaluated both on every read.
--
--    Merged so exactly one policy handles SELECT, with identical net
--    visibility: regular users see active rows, admins see everything.
--    The admin policy is narrowed from ALL to INSERT/UPDATE/DELETE.
--    Ordering matters: the merged SELECT policy is widened to include admins
--    BEFORE the FOR ALL policy is dropped, so admins never lose read access
--    even for an instant.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Storage: remove file enumeration, keep public object URLs working.
-- ---------------------------------------------------------------------------
drop policy if exists "public read cat photos" on storage.objects;
drop policy if exists "public read avatars"    on storage.objects;

-- ...but do NOT leave storage.objects with zero SELECT policies. The Storage
-- API resolves a row (SELECT) before it will UPDATE or DELETE it, so removing
-- every SELECT policy silently breaks an owner's ability to manage their OWN
-- files (verified: owner delete returned 403 "Access denied" until this policy
-- was added). Scope visibility to the owner instead of the whole bucket:
-- anonymous and cross-user enumeration stay blocked, owners keep control, and
-- public object URLs are unaffected either way.
drop policy if exists "owners read their own files" on storage.objects;
create policy "owners read their own files"
  on storage.objects for select to authenticated
  using (owner = (select auth.uid())
         and bucket_id = any (array['cat-photos'::text, 'avatars'::text]));

-- Owners keep full control of their own files. These already existed; re-assert
-- them with auth.uid() hoisted out of the per-row loop (same rule as 0017/0027,
-- which only covered the `public` schema).
alter policy "users update own files" on storage.objects
  using ((owner = (select auth.uid()))
         and (bucket_id = any (array['cat-photos'::text, 'avatars'::text])));

alter policy "users delete own files" on storage.objects
  using ((owner = (select auth.uid()))
         and (bucket_id = any (array['cat-photos'::text, 'avatars'::text])));

-- ---------------------------------------------------------------------------
-- 2. Rewards: one SELECT policy per table instead of two overlapping ones.
-- ---------------------------------------------------------------------------

-- reward_brands
alter policy "active brands are viewable" on public.reward_brands
  using (is_active or (select public.is_admin()));
drop policy if exists "admins manage brands" on public.reward_brands;
create policy "admins insert brands" on public.reward_brands
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update brands" on public.reward_brands
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete brands" on public.reward_brands
  for delete to authenticated using ((select public.is_admin()));

-- reward_offers
alter policy "active offers are viewable" on public.reward_offers
  using (is_active or (select public.is_admin()));
drop policy if exists "admins manage offers" on public.reward_offers;
create policy "admins insert offers" on public.reward_offers
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update offers" on public.reward_offers
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete offers" on public.reward_offers
  for delete to authenticated using ((select public.is_admin()));

-- sponsored_placements
alter policy "active placements are viewable" on public.sponsored_placements
  using (is_active or (select public.is_admin()));
drop policy if exists "admins manage placements" on public.sponsored_placements;
create policy "admins insert placements" on public.sponsored_placements
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update placements" on public.sponsored_placements
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete placements" on public.sponsored_placements
  for delete to authenticated using ((select public.is_admin()));
