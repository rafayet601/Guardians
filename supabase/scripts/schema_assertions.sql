-- ============================================================================
-- Guardians — schema_assertions
--
-- A drift detector, not a migration. Run it against any environment (Supabase
-- SQL editor, psql, CI) and it raises on the FIRST violated invariant. Exit
-- quietly = the database matches what this repo intends.
--
-- WHY THIS EXISTS
-- On 2026-07-17 an audit found the live DB had silently drifted from the repo:
-- Supabase's migration ledger listed 0012/0014/0017 as applied, yet their
-- objects were missing — most likely clobbered by a later re-run of an earlier
-- base migration (`create or replace function`, `drop policy`+`create policy`).
-- The most serious consequence was NOT a lint: `nearby_sightings` had reverted
-- to SECURITY INVOKER while 0011's column revokes stayed in place, so the live
-- map returned `42501 permission denied` for every signed-in user. Migration
-- 0027 repaired it. These assertions make a repeat loud instead of silent.
--
-- USAGE
--   psql "$DATABASE_URL" -f supabase/tests/schema_assertions.sql
--   -- or paste into the Supabase SQL editor. Success prints one NOTICE.
-- ============================================================================

do $$
declare
  v int;
  v_bool boolean;
begin
  -- ── 1. Privacy: raw coordinates must never be client-readable (0011) ──────
  -- These three revokes are what force the geo RPCs to be SECURITY DEFINER.
  if has_column_privilege('authenticated','public.sightings','lat','SELECT')
     or has_column_privilege('authenticated','public.sightings','lng','SELECT')
     or has_column_privilege('authenticated','public.sightings','location','SELECT') then
    raise exception 'DRIFT: `authenticated` can read raw sightings coordinates (0011 revoke lost)';
  end if;

  -- ── 2. Gamification integrity: score columns are RPC-only (0004/0007/0013) ─
  if has_column_privilege('authenticated','public.profiles','points','UPDATE')
     or has_column_privilege('authenticated','public.profiles','kibble_balance','UPDATE')
     or has_column_privilege('authenticated','public.profiles','level','UPDATE') then
    raise exception 'DRIFT: `authenticated` can write score columns on profiles';
  end if;
  if has_column_privilege('authenticated','public.sightings','status','UPDATE') then
    raise exception 'DRIFT: `authenticated` can write sightings.status directly';
  end if;
  if has_function_privilege('authenticated','public.award_points(uuid,integer,text,uuid)','EXECUTE') then
    raise exception 'DRIFT: `authenticated` can execute award_points() — unlimited points/Kibble (0013 revoke lost)';
  end if;

  -- ── 3. The P0 regression: every coord-reading RPC must be DEFINER + pinned ─
  -- A SECURITY INVOKER function here cannot read the columns revoked in (1),
  -- so it fails closed with 42501 and takes the feature down.
  select count(*) into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('nearby_sightings','get_sighting_detail','find_sighting_duplicates',
                      'find_lost_cat_matches','find_lost_cats_for_sighting',
                      'get_lost_cat_matches','rank_push_recipients')
    and (p.prosecdef is false or p.proconfig is null);
  if v > 0 then
    raise exception 'DRIFT: % geo RPC(s) are not SECURITY DEFINER with a pinned search_path — the map/detail screens will 42501', v;
  end if;

  -- ── 4. Moderation must actually hide content on the read path (0012) ──────
  select count(*) into v from pg_policies
  where schemaname='public' and tablename='sightings'
    and policyname='sightings are viewable by authenticated'
    and qual like '%is_hidden%';
  if v = 0 then
    raise exception 'DRIFT: sightings SELECT policy does not filter is_hidden — moderation bypass';
  end if;

  select count(*) into v from pg_policies
  where schemaname='public' and tablename='sighting_updates'
    and policyname='updates are viewable by authenticated'
    and qual like '%is_hidden%';
  if v = 0 then
    raise exception 'DRIFT: sighting_updates SELECT policy does not filter is_hidden — moderation bypass';
  end if;

  -- nearby_sightings bypasses RLS, so it needs its own is_hidden filter.
  select (pg_get_functiondef(p.oid) like '%is_hidden%') into v_bool
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='nearby_sightings';
  if v_bool is not true then
    raise exception 'DRIFT: nearby_sightings lost its is_hidden filter — hidden cats would reappear on the map';
  end if;

  -- ── 4b. Blocking must hide the blocked user's content server-side (0036) ──
  -- 0027's `alter policy` once reset the comment policy and silently dropped the
  -- block clause 0012/0017 had, and reports were never filtered at all.
  select count(*) into v from pg_policies
  where schemaname='public' and tablename='sightings'
    and policyname='sightings are viewable by authenticated'
    and qual like '%user_blocks%';
  if v = 0 then
    raise exception 'DRIFT: sightings SELECT policy ignores user_blocks — blocked users'' reports stay visible (apply migration 0036)';
  end if;

  select count(*) into v from pg_policies
  where schemaname='public' and tablename='sighting_updates'
    and policyname='updates are viewable by authenticated'
    and qual like '%user_blocks%';
  if v = 0 then
    raise exception 'DRIFT: sighting_updates SELECT policy ignores user_blocks — blocked users'' comments stay visible (apply migration 0036)';
  end if;

  select (pg_get_functiondef(p.oid) like '%user_blocks%'
          and pg_get_functiondef(p.oid) like '%c_coarse%') into v_bool
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='nearby_sightings';
  if v_bool is not true then
    raise exception 'DRIFT: nearby_sightings does not skip blocked users and measure against the coarsened point — exact locations can be solved from its distances (apply migration 0036)';
  end if;

  -- ── 4c. Claim / rescue points are paid once per cat (0037) ────────────────
  select (pg_get_functiondef('public.claim_sighting(uuid)'::regprocedure) like '%point_events%'
          and pg_get_functiondef('public.update_sighting_status(uuid,cat_status,text)'::regprocedure) like '%point_events%')
    into v_bool;
  if v_bool is not true then
    raise exception 'DRIFT: claim_sighting / update_sighting_status pay points on every transition — release+re-claim and safe<->available farm Kibble (apply migration 0037)';
  end if;

  -- ── 4d. The adoption loop can complete (0038) ─────────────────────────────
  -- Without the review queue nobody is ever cleared, so nothing can be adopted;
  -- without the pending check a withdrawn request completes an adoption.
  if to_regprocedure('public.list_screening_queue()') is null
     or to_regprocedure('public.decline_adoption_interest(uuid)') is null then
    raise exception 'DRIFT: no background-check review queue / decline — adopters can never be cleared (apply migration 0038)';
  end if;
  select (pg_get_functiondef('public.approve_adoption(uuid)'::regprocedure) like '%no longer open%')
    into v_bool;
  if v_bool is not true then
    raise exception 'DRIFT: approve_adoption accepts withdrawn or declined requests (apply migration 0038)';
  end if;
  select count(*) into v from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname='owners read screening docs' and qual like '%is_moderator%';
  if v = 0 then
    raise exception 'DRIFT: moderators cannot open ID photos, so background checks cannot be reviewed (apply migration 0038)';
  end if;

  -- ── 5. SECURITY DEFINER functions must pin search_path (0014) ─────────────
  select count(*) into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proconfig is null
    and p.proname not like 'st\_%'         -- PostGIS-owned, not ours to alter
    and p.proname not like 'geometry%'
    and p.proname not like 'geography%';
  if v > 0 then
    raise exception 'DRIFT: % SECURITY DEFINER function(s) have a mutable search_path', v;
  end if;

  -- ── 6. RLS policies hoist auth.uid() out of the per-row loop (0017) ───────
  select count(*) into v from pg_policies
  where schemaname='public'
    and ((qual       is not null and qual       ~ 'auth\.uid\(\)' and qual       !~ 'SELECT auth\.uid\(\)')
      or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~ 'SELECT auth\.uid\(\)'));
  if v > 0 then
    raise exception 'DRIFT: % RLS policy/policies call auth.uid() per row — wrap in (select auth.uid())', v;
  end if;

  -- ── 7. RLS is enabled on every app table ─────────────────────────────────
  select count(*) into v
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename <> 'spatial_ref_sys'   -- PostGIS-owned; cannot enable RLS
    and not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname=t.tablename and c.relrowsecurity
    );
  if v > 0 then
    raise exception 'DRIFT: % public table(s) have RLS disabled', v;
  end if;

  -- ── 8. Storage: no bucket-wide listing, but owners keep a SELECT path (0028)
  -- A SELECT policy on storage.objects that does not reference auth.uid() is
  -- bucket-wide, which lets ANY caller enumerate every file.
  select count(*) into v from pg_policies
  where schemaname='storage' and tablename='objects' and cmd='SELECT'
    and qual !~ 'auth\.uid\(\)';
  if v > 0 then
    raise exception 'DRIFT: % storage SELECT policy/policies allow bucket-wide file listing', v;
  end if;

  -- ...and the inverse: removing ALL SELECT policies breaks owner delete/update,
  -- because the Storage API resolves the row before mutating it.
  select count(*) into v from pg_policies
  where schemaname='storage' and tablename='objects' and cmd='SELECT' and qual ~ 'owner';
  if v = 0 then
    raise exception 'DRIFT: no owner-scoped SELECT on storage.objects — owners cannot delete/update their own files';
  end if;

  -- ── 9. Rewards: exactly one permissive read policy per table (0028) ───────
  select count(*) into v from (
    select tablename from pg_policies
    where schemaname='public'
      and tablename in ('reward_brands','reward_offers','sponsored_placements')
      and permissive='PERMISSIVE' and cmd in ('SELECT','ALL')
    group by tablename having count(*) > 1
  ) x;
  if v > 0 then
    raise exception 'DRIFT: % rewards table(s) have overlapping permissive SELECT policies', v;
  end if;

  -- ── 10. Creation writes and quota reservations are server-owned (0039) ────
  if has_table_privilege('authenticated', 'public.sightings', 'INSERT')
     or has_table_privilege('authenticated', 'public.lost_cats', 'INSERT')
     or has_column_privilege('authenticated', 'public.sighting_updates', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.sighting_photos', 'created_at', 'INSERT') then
    raise exception 'DRIFT: direct creation can forge lifecycle/timestamps (apply migration 0039)';
  end if;
  if to_regprocedure('private.reserve_request(uuid,text,integer,interval)') is null
     or to_regprocedure('public.validate_screening_document_paths()') is null then
    raise exception 'DRIFT: atomic quotas or screening-document validation are absent (apply migration 0039)';
  end if;
  if pg_get_functiondef('public.check_ai_rate_limit(text,integer)'::regprocedure)
       not like '%reserve_request%' then
    raise exception 'DRIFT: AI quota does not reserve before provider calls (apply migration 0039)';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.adopter_screenings'::regclass
      and tgname = 'validate_screening_document_paths' and tgenabled <> 'D') then
    raise exception 'DRIFT: screening documents lack validation trigger (apply migration 0039)';
  end if;

  -- ── 11. Storage API limits exist independently of app validation (0040) ───
  select count(*) into v from storage.buckets
  where id in ('avatars', 'cat-photos', 'screening-docs')
    and file_size_limit > 0
    and file_size_limit <= case when id = 'screening-docs' then 10485760 else 5242880 end
    and allowed_mime_types is not null
    and cardinality(allowed_mime_types) > 0
    and allowed_mime_types <@ case when id = 'screening-docs'
      then array['image/jpeg','image/png','image/webp','image/heic','image/heif']
      else array['image/jpeg','image/png','image/webp'] end
    and (id <> 'screening-docs' or not public);
  if v <> 3 then
    raise exception 'DRIFT: missing private storage/MIME/size upload bounds (apply migration 0040)';
  end if;

  -- ── 12. Child tables honor their parent visibility; photo cap locks (0041) ─
  if to_regprocedure('public.can_access_sighting_content(uuid)') is null then
    raise exception 'DRIFT: child-table parent visibility guard is absent (apply migration 0041)';
  end if;
  select count(*) into v from pg_policies
  where schemaname = 'public' and tablename in ('sighting_photos','sighting_updates')
    and cmd = 'SELECT' and qual like '%can_access_sighting_content%';
  if v <> 2 then
    raise exception 'DRIFT: child-table reads bypass hidden/blocked parents (apply migration 0041)';
  end if;
  if pg_get_functiondef('public.enforce_photo_cap()'::regprocedure) not like '%for update%' then
    raise exception 'DRIFT: concurrent attachments can bypass the photo ceiling (apply migration 0041)';
  end if;

  -- ── 13. Claims are leases the server enforces; urgent reports escalate (0042) ─
  if to_regprocedure('private.expire_stale_claims(timestamptz)') is null
     or to_regprocedure('private.escalate_unclaimed_urgent(timestamptz)') is null
     or to_regprocedure('private.run_job(text)') is null then
    raise exception 'DRIFT: claim-lease or escalation jobs are absent (apply migration 0042)';
  end if;
  select count(*) into v from pg_trigger
  where not tgisinternal and tgenabled <> 'D'
    and (tgrelid, tgname) in (
      ('public.sightings'::regclass, 'sightings_claim_lease'),
      ('public.sighting_updates'::regclass, 'sighting_updates_renew_claim'),
      ('public.sighting_photos'::regclass, 'sighting_photos_renew_claim'));
  if v <> 3 then
    raise exception 'DRIFT: lease triggers are missing or disabled (apply migration 0042)';
  end if;
  -- Bookkeeping columns must not count as activity on the case.
  select count(*) into v from pg_trigger
  where tgrelid = 'public.sightings'::regclass and tgname = 'sightings_set_updated_at'
    and tgenabled <> 'D' and tgfoid = 'public.set_sighting_updated_at()'::regprocedure;
  if v <> 1 then
    raise exception 'DRIFT: sightings_set_updated_at is missing, disabled or not lease-aware (0042)';
  end if;
  select count(*) into v from cron.job
  where active and jobname in ('guardians-claim-leases', 'guardians-urgent-escalation',
                               'guardians-prune-job-runs');
  if v <> 3 then
    raise exception 'DRIFT: scheduled jobs are not registered or not active (apply migration 0042)';
  end if;
  if has_column_privilege('authenticated','public.sightings','claim_expires_at','UPDATE')
     or has_column_privilege('authenticated','public.sightings','escalation_step','UPDATE')
     or has_function_privilege('authenticated','private.run_job(text)','EXECUTE')
     or has_function_privilege('authenticated',
          'public.tokens_in_ring(double precision, double precision, integer, integer, uuid)','EXECUTE') then
    raise exception 'DRIFT: a client can write the lease, run a job or list devices (0042)';
  end if;
  -- A claim without a lease would never lapse.
  select count(*) into v from public.sightings
  where claimed_by is not null and status in ('claimed','in_rescue') and claim_expires_at is null;
  if v <> 0 then
    raise exception 'DRIFT: % active claim(s) have no lease (0042)', v;
  end if;

  -- ── 14. Alert preferences and the inbox (0043) ──────────────────────────────
  if to_regclass('public.notifications') is null
     or to_regclass('public.alert_preferences') is null
     or to_regprocedure('private.broadcast_urgent(uuid, integer)') is null
     or to_regprocedure('public.batch_push_tokens(uuid)') is null then
    raise exception 'DRIFT: the inbox or alert preferences are absent (apply migration 0043)';
  end if;
  select count(*) into v from pg_class
  where oid in ('public.notifications'::regclass, 'public.alert_preferences'::regclass)
    and relrowsecurity;
  if v <> 2 then
    raise exception 'DRIFT: RLS is off on notifications or alert_preferences (0043)';
  end if;
  if has_table_privilege('authenticated','public.notifications','INSERT')
     or has_table_privilege('authenticated','public.notifications','UPDATE')
     or has_table_privilege('authenticated','public.alert_preferences','INSERT')
     or has_table_privilege('authenticated','public.alert_preferences','UPDATE')
     or has_function_privilege('authenticated','public.batch_push_tokens(uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.post_push(jsonb)','EXECUTE') then
    raise exception 'DRIFT: a client can write an inbox or preferences, send, or list devices (0043)';
  end if;
  -- The funnel must record before it sends: post_push writes the inbox.
  if position('public.notifications' in
       pg_get_functiondef('private.post_push(jsonb)'::regprocedure)) = 0 then
    raise exception 'DRIFT: private.post_push no longer records to the inbox (0043)';
  end if;
  select count(*) into v from cron.job
  where active and jobname = 'guardians-prune-notifications';
  if v <> 1 then
    raise exception 'DRIFT: the inbox prune job is not registered or not active (0043)';
  end if;

  -- ── 15. No SECURITY DEFINER function of ours is callable signed out (0044) ─
  -- Supabase grants anon EXECUTE by default; a revoke from PUBLIC misses it.
  -- Extension-owned functions (PostGIS) are excluded: not ours to alter.
  select count(*) into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if v > 0 then
    raise exception 'DRIFT: % SECURITY DEFINER function(s) are callable without signing in (0044)', v;
  end if;

  raise notice 'schema_assertions: OK — all invariants hold through 0044.';
end $$;
