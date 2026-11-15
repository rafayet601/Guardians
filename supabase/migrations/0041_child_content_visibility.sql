-- Raw child-table endpoints must respect the same hidden/blocked parent
-- visibility as get_sighting_detail(), including the assigned Guardian.
-- Existing public photo URLs remain public: this prevents row discovery, not
-- revocation of previously known URLs. Keep the established public buckets.
create or replace function public.can_access_sighting_content(p_sighting uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.sightings;
  v_moderator boolean;
begin
  if v_uid is null then return false; end if;
  select * into v_s from public.sightings where id = p_sighting;
  if not found then return false; end if;
  v_moderator := public.is_moderator();
  if not v_moderator and exists (
    select 1 from public.user_blocks b
    where b.blocker_id = v_uid and b.blocked_id = v_s.reporter_id
  ) then return false; end if;
  return not v_s.is_hidden or v_moderator
    or v_uid = coalesce(v_s.reporter_id, '00000000-0000-0000-0000-000000000000'::uuid)
    or v_uid = coalesce(v_s.claimed_by, '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;
revoke all on function public.can_access_sighting_content(uuid) from public, anon;
grant execute on function public.can_access_sighting_content(uuid) to authenticated;

alter policy "photos are viewable by authenticated" on public.sighting_photos
  using (public.can_access_sighting_content(sighting_id));
alter policy "users add photos" on public.sighting_photos
  with check (uploaded_by = (select auth.uid())
    and public.can_access_sighting_content(sighting_id));

alter policy "updates are viewable by authenticated" on public.sighting_updates
  using (
    public.can_access_sighting_content(sighting_id)
    and (not is_hidden or author_id = (select auth.uid()) or public.is_moderator())
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = (select auth.uid()) and b.blocked_id = sighting_updates.author_id
    )
  );
alter policy "users post comments" on public.sighting_updates
  with check (
    author_id = (select auth.uid()) and type = 'comment'
    and old_status is null and new_status is null
    and public.can_access_sighting_content(sighting_id)
  );

-- Serialize concurrent attachments to one report before counting. Without a
-- parent lock, many uploads can all observe fewer than twelve existing rows.
create or replace function public.enforce_photo_cap()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.sightings where id = new.sighting_id for update;
  if (select count(*) from public.sighting_photos where sighting_id = new.sighting_id) >= 12 then
    raise exception 'This sighting already has the maximum number of photos'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_photo_cap() from public, anon, authenticated;
