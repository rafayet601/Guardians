-- ============================================================================
-- Guardians — 0026_ai_rls_initplan_and_fk_indexes
-- Advisor cleanup after the AI migrations (0019–0025). Two follow-ups the
-- `get_advisors` performance run flagged, both matching conventions the repo
-- already established for its pre-AI tables:
--
--   1. auth_rls_initplan (0017 convention): the RLS policies added in 0023/0025
--      call `auth.uid()` directly, which Postgres re-evaluates per row. Wrap it
--      in a scalar subquery `(select auth.uid())` so it is evaluated once per
--      query — exactly the rewrite 0017 applied to the older policies.
--   2. unindexed_foreign_keys (0015 convention): add covering indexes for the
--      two FKs the advisor flagged (`ai_usage.user_id`, `sighting_links.created_by`).
--
-- Additive / idempotent. No behavioural change — the USING/WITH CHECK predicates
-- are logically identical, only the evaluation is hoisted.
-- ============================================================================

-- 1. RLS init-plan: recreate the AI policies with (select auth.uid()) ---------

-- sighting_links (0023)
drop policy if exists "links visible to reporter/guardian" on public.sighting_links;
create policy "links visible to reporter/guardian"
  on public.sighting_links for select to authenticated
  using (
    exists (
      select 1 from public.sightings s
      where s.id = sighting_id
        and (s.reporter_id = (select auth.uid()) or s.claimed_by = (select auth.uid()))
    )
    or exists (
      select 1 from public.sightings s
      where s.id = linked_sighting_id
        and (s.reporter_id = (select auth.uid()) or s.claimed_by = (select auth.uid()))
    )
  );

-- lost_cats (0025)
drop policy if exists "owners create their lost cats" on public.lost_cats;
create policy "owners create their lost cats"
  on public.lost_cats for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners edit their lost cats" on public.lost_cats;
create policy "owners edit their lost cats"
  on public.lost_cats for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owners delete their lost cats" on public.lost_cats;
create policy "owners delete their lost cats"
  on public.lost_cats for delete to authenticated
  using (owner_id = (select auth.uid()));

-- lost_cat_matches (0025)
drop policy if exists "matches visible to lost owner or sighting reporter/guardian" on public.lost_cat_matches;
create policy "matches visible to lost owner or sighting reporter/guardian"
  on public.lost_cat_matches for select to authenticated
  using (
    exists (
      select 1 from public.lost_cats lc
      where lc.id = lost_cat_id and lc.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.sightings s
      where s.id = sighting_id
        and (s.reporter_id = (select auth.uid()) or s.claimed_by = (select auth.uid()))
    )
  );

-- 2. Covering indexes for the flagged foreign keys (0015 convention) ----------
create index if not exists ai_usage_user_idx
  on public.ai_usage (user_id);
create index if not exists sighting_links_created_by_idx
  on public.sighting_links (created_by);
