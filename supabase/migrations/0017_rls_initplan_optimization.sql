-- ============================================================================
-- Guardians — 0017_rls_initplan_optimization
-- Wrap auth.uid() in (select auth.uid()) across all RLS policies so Postgres
-- evaluates it once per query instead of once per row (auth_rls_initplan
-- performance advisor). ALTER POLICY preserves roles/commands and never leaves a
-- window without a policy; logic is byte-for-byte identical apart from the wrap.
-- (applied to the live DB via MCP 2026-06-23)
-- ============================================================================

alter policy "reports visible to reporter or moderators" on public.abuse_reports
  using (((reporter_id = (select auth.uid())) OR is_moderator()));

alter policy "interest visible to adopter and lister" on public.adoption_interest
  using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
     FROM sightings s
    WHERE ((s.id = adoption_interest.sighting_id) AND ((s.reporter_id = (select auth.uid())) OR (s.claimed_by = (select auth.uid()))))))));

alter policy "users withdraw their interest" on public.adoption_interest
  using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));

alter policy "owners manage their push tokens" on public.device_push_tokens
  using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));

alter policy "users read their own point events" on public.point_events
  using ((user_id = (select auth.uid())));

alter policy "users update their own profile" on public.profiles
  using ((id = (select auth.uid()))) with check ((id = (select auth.uid())));

alter policy "users read their own redemptions" on public.reward_redemptions
  using ((user_id = (select auth.uid())));

alter policy "users add photos" on public.sighting_photos
  with check ((uploaded_by = (select auth.uid())));

alter policy "users delete their photos" on public.sighting_photos
  using ((uploaded_by = (select auth.uid())));

alter policy "updates are viewable by authenticated" on public.sighting_updates
  using ((((NOT is_hidden) OR (author_id = (select auth.uid())) OR is_moderator()) AND (NOT (EXISTS ( SELECT 1
     FROM user_blocks b
    WHERE ((b.blocker_id = (select auth.uid())) AND (b.blocked_id = sighting_updates.author_id)))))));

alter policy "users delete their comments" on public.sighting_updates
  using (((author_id = (select auth.uid())) AND (type = 'comment'::update_type)));

alter policy "users post comments" on public.sighting_updates
  with check (((author_id = (select auth.uid())) AND (type = 'comment'::update_type) AND (old_status IS NULL) AND (new_status IS NULL)));

alter policy "reporters delete their own sightings" on public.sightings
  using ((reporter_id = (select auth.uid())));

alter policy "reporters edit their own sightings" on public.sightings
  using ((reporter_id = (select auth.uid()))) with check ((reporter_id = (select auth.uid())));

alter policy "sightings are viewable by authenticated" on public.sightings
  using (((NOT is_hidden) OR (reporter_id = (select auth.uid())) OR is_moderator()));

alter policy "users create their own sightings" on public.sightings
  with check ((reporter_id = (select auth.uid())));

alter policy "users manage their blocks" on public.user_blocks
  using ((blocker_id = (select auth.uid()))) with check ((blocker_id = (select auth.uid())));

alter policy "users read their own wallet" on public.wallet_transactions
  using ((user_id = (select auth.uid())));
