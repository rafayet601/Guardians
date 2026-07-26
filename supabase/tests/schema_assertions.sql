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

  raise notice 'schema_assertions: OK — all invariants hold.';
end $$;
