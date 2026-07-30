-- ============================================================================
-- Guardians — 0029_push_lifecycle
-- P1-4 — server-side lifecycle push notifications. Until now the ONLY push was
-- the urgent-sighting geo-broadcast, fired CLIENT-side (fire-and-forget) right
-- after creating an urgent report — if the app crashed, no alert went out.
-- This migration moves that trigger into the database and adds the lifecycle
-- events, all via pg_net → the `send-push` Edge Function:
--
--   urgent_sighting    sightings INSERT with needs_urgent_help → geo fan-out
--                      (recipient NULL; send-push runs tokens_near as before)
--   sighting_claimed   sightings status → 'claimed'  → push the REPORTER
--   rescue_completed   sightings status → 'safe'     → push the REPORTER
--   adoption_interest  adoption_interest INSERT      → push the LISTER
--                      (assigned guardian `claimed_by` when set, else reporter)
--
-- A lifecycle push is skipped when the recipient IS the actor (auth.uid()) —
-- nobody needs a push about their own action. Because the status/adoption
-- writes go through SECURITY DEFINER RPCs (claim_sighting,
-- update_sighting_status, express_adoption_interest — 0002), auth.uid() inside
-- the trigger still reflects the real caller.
--
-- Secrets live in `private.push_config`, readable by NO client role (the
-- private schema is not API-exposed and every client grant is revoked); only
-- the SECURITY DEFINER enqueue function (owner postgres) reads it. The founder
-- MUST populate it post-deploy, until then every event no-ops with a WARNING:
--
--   update private.push_config
--     set value = 'https://<project-ref>.supabase.co/functions/v1/send-push'
--     where key = 'edge_function_url';
--   update private.push_config
--     set value = '<random string — MUST equal the PUSH_WEBHOOK_SECRET edge secret>'
--     where key = 'webhook_secret';
--
--   supabase secrets set PUSH_WEBHOOK_SECRET=<the same random string>
--
-- `send-push` authenticates the call via the `x-push-webhook-secret` header
-- (verify_jwt is off for the function — pg_net carries no user JWT; see
-- config.toml). A push enqueue failure is caught and downgraded to a WARNING
-- so it can NEVER roll back the user's sighting/claim/adoption write.
--
-- Also adds the `push_enabled` master flag on device_push_tokens plus the
-- client-facing `set_push_enabled(boolean)` RPC to flip it for all of the
-- caller's devices (the 0010 prefs are plain boolean columns — urgent_opt_in /
-- notify_radius_m — so the new flag follows that shape, no jsonb). Because it
-- is a MASTER switch, `tokens_near` (0010) is republished below with the same
-- filter, so the flag is honored by the urgent fan-out as well as the
-- lifecycle path — an opt-out that still let 🚨 broadcasts through would not
-- be an opt-out.
--
-- Additive only. NOT applied here — the human applies it to the live project
-- (via MCP `apply_migration`) with explicit authorization, then re-runs the
-- security + performance advisors. Follows the 0014/0016/0019/0023 convention:
-- pinned search_path, revoke public/anon (and authenticated where it is not a
-- client RPC), grant only to the role that must call it.
-- ============================================================================

-- pg_net pins its own `net` schema (relocatable = false), so it must be created
-- without a WITH SCHEMA clause — the call site below is `net.http_post`.
-- Verify right after applying:
--   select extnamespace::regnamespace from pg_extension where extname = 'pg_net';
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- private.push_config — webhook URL + shared secret for the enqueue function.
-- Seeded EMPTY so a fresh environment can't accidentally call a real endpoint;
-- the founder UPDATEs the two rows post-deploy (see header). No client role
-- can read it: the `private` schema is not in the API's exposed schemas and
-- every grant is revoked here as defense in depth. The founder edits it via
-- the SQL editor (postgres role).
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.push_config (
  key   text primary key,
  value text not null
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.push_config from public, anon, authenticated;

comment on table private.push_config is
  'send-push webhook config (edge_function_url, webhook_secret). Founder-maintained; never client-readable. See migration 0029.';

insert into private.push_config (key, value) values
  ('edge_function_url', ''),  -- TODO founder: https://<project-ref>.supabase.co/functions/v1/send-push
  ('webhook_secret',    '')   -- TODO founder: random string == PUSH_WEBHOOK_SECRET edge secret
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- push_enabled — per-device master switch for push delivery, flipped for all
-- of a user's devices via set_push_enabled() below. Default true so existing
-- tokens keep receiving pushes. (0010's prefs are boolean columns; this
-- follows that shape.)
-- ---------------------------------------------------------------------------
alter table public.device_push_tokens
  add column if not exists push_enabled boolean not null default true;

comment on column public.device_push_tokens.push_enabled is
  'Master push opt-out for this device (set_push_enabled). Honored by BOTH send-push paths: tokens_near (urgent fan-out) and the lifecycle path.';

-- ---------------------------------------------------------------------------
-- tokens_near — republished from 0010 with the `push_enabled` filter added.
--
-- Without this, the master opt-out would be honored only by the lifecycle
-- path, so a user who turned notifications OFF would keep receiving the urgent
-- geo-broadcast — the loudest, highest-volume push in the app, and the one the
-- primer copy and privacy policy both describe as opt-in. Otherwise byte-for-
-- byte identical to 0010 (same signature, so `create or replace` preserves the
-- existing service_role-only ACL; the grants below are restated for clarity).
--
-- ⚠ CONTRACT: `rank_push_recipients` (0022) re-implements this filter in its
-- `geo` CTE and documents "if tokens_near changes, this filter MUST change to
-- match". That function is NOT wired into send-push today (urgentGeoFanout
-- calls tokens_near directly), so the sets cannot diverge in production yet —
-- but `and t.push_enabled` must be added to its `geo` CTE before the ranked
-- variant ships, or ranking would re-admit opted-out users.
-- ---------------------------------------------------------------------------
create or replace function public.tokens_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 8000,
  p_exclude_user uuid default null
)
returns table (token text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select t.token
  from public.device_push_tokens t
  where t.urgent_opt_in
    and t.push_enabled
    and t.last_known_location is not null
    and (p_exclude_user is null or t.user_id <> p_exclude_user)
    and st_dwithin(
      t.last_known_location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      least(p_radius_m, t.notify_radius_m)
    );
$$;

revoke execute on function public.tokens_near(double precision, double precision, integer, uuid) from public, anon, authenticated;
grant  execute on function public.tokens_near(double precision, double precision, integer, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- enqueue_push_notification — the single funnel from DB triggers to the
-- send-push Edge Function. Reads private.push_config and POSTs
-- { type, sighting_id, recipient_user_id } with the shared-secret header via
-- pg_net (async — the transaction never waits on the HTTP response).
--
-- SECURITY DEFINER (owner postgres) so it can read the locked-down config
-- table and call net.http_post regardless of the triggering role. NEVER
-- callable by clients (no EXECUTE grant — only triggers run it, as owner).
-- Never raises: an unconfigured endpoint or an enqueue error is a WARNING, so
-- pushes can never break a user write.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_push_notification(
  p_type              text,
  p_sighting_id       uuid,
  p_recipient_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select c.value into v_url    from private.push_config c where c.key = 'edge_function_url';
  select c.value into v_secret from private.push_config c where c.key = 'webhook_secret';

  if v_url is null or btrim(v_url) = '' or v_secret is null or btrim(v_secret) = '' then
    raise warning 'enqueue_push_notification: private.push_config not configured — skipping "%" push for sighting %',
      p_type, p_sighting_id;
    return;
  end if;

  begin
    perform net.http_post(
      url     => v_url,
      headers => jsonb_build_object(
        'Content-Type',          'application/json',
        'x-push-webhook-secret', v_secret
      ),
      body    => jsonb_build_object(
        'type',              p_type,
        'sighting_id',       p_sighting_id,
        'recipient_user_id', p_recipient_user_id
      ),
      timeout_milliseconds => 5000  -- cold-start headroom; the response is discarded
    );
  exception when others then
    -- A push is best-effort: never roll back the user's write because the
    -- queue or endpoint hiccuped.
    raise warning 'enqueue_push_notification: failed to enqueue "%" push for sighting %: %',
      p_type, p_sighting_id, sqlerrm;
  end;
end;
$$;

-- Trigger-only: reachable via the /rpc endpoint by NO client role (triggers
-- fire as the function owner, independent of EXECUTE grants — 0014 pattern).
revoke execute on function public.enqueue_push_notification(text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: urgent sighting reported → geo fan-out (recipient NULL; send-push
-- resolves the audience via tokens_near exactly as the old client call did).
-- ---------------------------------------------------------------------------
create or replace function public.on_urgent_sighting_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_push_notification('urgent_sighting', new.id, null);
  return new;
end;
$$;

revoke execute on function public.on_urgent_sighting_push() from public, anon, authenticated;

drop trigger if exists sightings_push_urgent on public.sightings;
create trigger sightings_push_urgent
  after insert on public.sightings
  for each row
  when (new.needs_urgent_help)
  execute function public.on_urgent_sighting_push();

-- ---------------------------------------------------------------------------
-- Trigger: status transitions the reporter cares about. The reporter is never
-- notified of their OWN action (e.g. reporter marks their own report safe, or
-- claims their own sighting — claim_sighting doesn't forbid that).
-- ---------------------------------------------------------------------------
create or replace function public.on_sighting_status_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'claimed' then
    if new.reporter_id is not null and new.reporter_id is distinct from auth.uid() then
      perform public.enqueue_push_notification('sighting_claimed', new.id, new.reporter_id);
    end if;
  elsif new.status = 'safe' then
    if new.reporter_id is not null and new.reporter_id is distinct from auth.uid() then
      perform public.enqueue_push_notification('rescue_completed', new.id, new.reporter_id);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.on_sighting_status_push() from public, anon, authenticated;

drop trigger if exists sightings_push_status on public.sightings;
create trigger sightings_push_status
  after update of status on public.sightings
  for each row
  when (old.status is distinct from new.status)
  execute function public.on_sighting_status_push();

-- ---------------------------------------------------------------------------
-- Trigger: an adopter expressed interest → notify the lister (the assigned
-- guardian `claimed_by` when set, else the reporter). Skipped when the lister
-- somehow IS the adopter (express_adoption_interest already forbids that —
-- this is defense in depth). Fires on INSERT only: the RPC's on-conflict
-- re-express path is an UPDATE, so re-expressing interest never re-pushes.
-- ---------------------------------------------------------------------------
create or replace function public.on_adoption_interest_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
begin
  select coalesce(s.claimed_by, s.reporter_id) into v_recipient
  from public.sightings s
  where s.id = new.sighting_id;

  if v_recipient is not null and v_recipient is distinct from auth.uid() then
    perform public.enqueue_push_notification('adoption_interest', new.sighting_id, v_recipient);
  end if;
  return new;
end;
$$;

revoke execute on function public.on_adoption_interest_push() from public, anon, authenticated;

drop trigger if exists adoption_interest_push on public.adoption_interest;
create trigger adoption_interest_push
  after insert on public.adoption_interest
  for each row
  execute function public.on_adoption_interest_push();

-- ---------------------------------------------------------------------------
-- set_push_enabled — flip the push_enabled master flag on ALL of the caller's
-- device token rows. Client-facing RPC (the settings toggle). SECURITY
-- DEFINER so it can update past the owner-only RLS in one statement; the
-- WHERE pins the write to auth.uid(). Returns void — no row count leaks.
-- ---------------------------------------------------------------------------
create or replace function public.set_push_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  update public.device_push_tokens t
     set push_enabled = coalesce(p_enabled, true)
   where t.user_id = uid;
end;
$$;

revoke execute on function public.set_push_enabled(boolean) from public, anon;
grant  execute on function public.set_push_enabled(boolean) to authenticated;
