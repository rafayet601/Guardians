-- ============================================================================
-- Guardians — 0005_storage
-- Public-read buckets for cat photos and avatars. Uploads are scoped to a
-- per-user folder ("{uid}/...") so users can only write under their own path.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('cat-photos', 'cat-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read ----------------------------------------------------------------
drop policy if exists "public read cat photos" on storage.objects;
create policy "public read cat photos"
  on storage.objects for select to public
  using (bucket_id = 'cat-photos');

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars"
  on storage.objects for select to public
  using (bucket_id = 'avatars');

-- Upload into your own folder -------------------------------------------------
drop policy if exists "users upload cat photos" on storage.objects;
create policy "users upload cat photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cat-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users upload avatars" on storage.objects;
create policy "users upload avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Manage your own files -------------------------------------------------------
drop policy if exists "users update own files" on storage.objects;
create policy "users update own files"
  on storage.objects for update to authenticated
  using (owner = auth.uid() and bucket_id in ('cat-photos', 'avatars'));

drop policy if exists "users delete own files" on storage.objects;
create policy "users delete own files"
  on storage.objects for delete to authenticated
  using (owner = auth.uid() and bucket_id in ('cat-photos', 'avatars'));
