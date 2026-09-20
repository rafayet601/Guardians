-- Erase authored content in the same transaction as account removal. Storage
-- bytes are removed by delete-account before Auth performs this transaction.
create or replace function public.erase_profile_content()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.embeddings where
    (owner_type='sighting' and owner_id in (select id from public.sightings where reporter_id=old.id)) or
    (owner_type='lost_cat' and owner_id in (select id from public.lost_cats where owner_id=old.id));
  delete from public.sighting_updates where author_id=old.id;
  delete from public.sighting_photos where uploaded_by=old.id;
  delete from public.sightings where reporter_id=old.id;
  delete from public.ai_usage where user_id=old.id;
  delete from public.analytics_events where user_id=old.id;
  return old;
end $$;
revoke execute on function public.erase_profile_content() from public,anon,authenticated;
create trigger erase_profile_content before delete on public.profiles
for each row execute function public.erase_profile_content();
