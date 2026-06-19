-- ============================================================================
-- Guardians — 0004_rls
-- Row Level Security. Enabling RLS with no policy denies all access by default,
-- so every readable table gets an explicit SELECT policy.
--
-- Sensitive columns (points, level, status, counts) are protected with
-- COLUMN-LEVEL GRANTs: clients may only UPDATE descriptive fields directly.
-- Score/status mutations happen exclusively through the SECURITY DEFINER RPCs
-- in 0002_functions.sql, which run as the table owner and bypass RLS.
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.sightings         enable row level security;
alter table public.sighting_photos   enable row level security;
alter table public.sighting_updates  enable row level security;
alter table public.adoption_interest enable row level security;
alter table public.badges            enable row level security;
alter table public.user_badges       enable row level security;
alter table public.point_events      enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists "profiles are viewable by authenticated" on public.profiles;
create policy "profiles are viewable by authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Lock down the score columns: clients can only touch the editable fields.
revoke update on public.profiles from anon, authenticated;
grant  update (username, full_name, avatar_url, bio, is_guardian, wants_to_adopt)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- device_push_tokens  (strictly owner-only — never visible to other users)
-- ---------------------------------------------------------------------------
alter table public.device_push_tokens enable row level security;

drop policy if exists "owners manage their push tokens" on public.device_push_tokens;
create policy "owners manage their push tokens"
  on public.device_push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- sightings
-- ---------------------------------------------------------------------------
drop policy if exists "sightings are viewable by authenticated" on public.sightings;
create policy "sightings are viewable by authenticated"
  on public.sightings for select to authenticated using (true);

drop policy if exists "users create their own sightings" on public.sightings;
create policy "users create their own sightings"
  on public.sightings for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "reporters edit their own sightings" on public.sightings;
create policy "reporters edit their own sightings"
  on public.sightings for update to authenticated
  using (reporter_id = auth.uid()) with check (reporter_id = auth.uid());

drop policy if exists "reporters delete their own sightings" on public.sightings;
create policy "reporters delete their own sightings"
  on public.sightings for delete to authenticated
  using (reporter_id = auth.uid());

-- status / claim columns are only mutable via the transition RPCs
revoke update on public.sightings from anon, authenticated;
grant  update (title, description, color, temperament, is_injured, needs_urgent_help, address)
  on public.sightings to authenticated;

-- ---------------------------------------------------------------------------
-- sighting_photos
-- ---------------------------------------------------------------------------
drop policy if exists "photos are viewable by authenticated" on public.sighting_photos;
create policy "photos are viewable by authenticated"
  on public.sighting_photos for select to authenticated using (true);

drop policy if exists "users add photos" on public.sighting_photos;
create policy "users add photos"
  on public.sighting_photos for insert to authenticated
  with check (uploaded_by = auth.uid());

drop policy if exists "users delete their photos" on public.sighting_photos;
create policy "users delete their photos"
  on public.sighting_photos for delete to authenticated
  using (uploaded_by = auth.uid());

-- ---------------------------------------------------------------------------
-- sighting_updates  (only plain comments may be inserted directly;
-- status_change / claim / system rows come from the RPCs)
-- ---------------------------------------------------------------------------
drop policy if exists "updates are viewable by authenticated" on public.sighting_updates;
create policy "updates are viewable by authenticated"
  on public.sighting_updates for select to authenticated using (true);

drop policy if exists "users post comments" on public.sighting_updates;
create policy "users post comments"
  on public.sighting_updates for insert to authenticated
  with check (
    author_id = auth.uid()
    and type = 'comment'
    and old_status is null
    and new_status is null
  );

drop policy if exists "users delete their comments" on public.sighting_updates;
create policy "users delete their comments"
  on public.sighting_updates for delete to authenticated
  using (author_id = auth.uid() and type = 'comment');

-- ---------------------------------------------------------------------------
-- adoption_interest  (created/approved via RPC; users can read & withdraw)
-- ---------------------------------------------------------------------------
drop policy if exists "interest visible to adopter and lister" on public.adoption_interest;
create policy "interest visible to adopter and lister"
  on public.adoption_interest for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.sightings s
      where s.id = sighting_id
        and (s.reporter_id = auth.uid() or s.claimed_by = auth.uid())
    )
  );

drop policy if exists "users withdraw their interest" on public.adoption_interest;
create policy "users withdraw their interest"
  on public.adoption_interest for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- badges  (public reference data)
-- ---------------------------------------------------------------------------
drop policy if exists "badges are public" on public.badges;
create policy "badges are public"
  on public.badges for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- user_badges  (public achievements)
-- ---------------------------------------------------------------------------
drop policy if exists "user badges are viewable" on public.user_badges;
create policy "user badges are viewable"
  on public.user_badges for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- point_events  (private to the owner)
-- ---------------------------------------------------------------------------
drop policy if exists "users read their own point events" on public.point_events;
create policy "users read their own point events"
  on public.point_events for select to authenticated
  using (user_id = auth.uid());
