-- 0043 — Alert preferences, the notification inbox, and the reporter's
-- feedback loop.
--
-- PRD-2.0 R1.3 (a Guardian sets a home area, radius, the alerts they want,
-- quiet hours and an on-duty switch), R1.5 (every push is also an inbox entry
-- with read state) and R1.9 (the reporter hears about every state change).
--
-- Architecture directive 4: one notification path. private.post_push is that
-- path. It writes the inbox row and queues the push in the same transaction as
-- the event, so a push that never arrives does not lose the message. The two
-- older funnels (enqueue_push_notification from 0029, enqueue_push_event from
-- 0038) now hand over to it, and the 0042 jobs already call it.
--
-- Urgent broadcasts change audience: they are resolved per person from
-- alert_preferences, not per device. That is what lets a Guardian who denied
-- push permission still find the alert in the inbox, and what lets quiet hours
-- silence the push while keeping the entry. send-push is told which batch of
-- inbox rows to deliver. A send-push deployed before this migration ignores
-- the batch and falls back to tokens_near, so either deploy order is safe.
--
-- Nothing here pushes on apply. Apply after staging rehearsal, after 0042.

-- ---------------------------------------------------------------------------
-- 1. Alert preferences (R1.3)
-- ---------------------------------------------------------------------------
create table if not exists public.alert_preferences (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  on_duty        boolean not null default true,
  urgent_alerts  boolean not null default true,
  home_location  geography(Point, 4326),
  home_lat       double precision generated always as (st_y(home_location::geometry)) stored,
  home_lng       double precision generated always as (st_x(home_location::geometry)) stored,
  home_source    text not null default 'device',
  radius_m       integer not null default 8000,
  wider_radius_m integer not null default 20000,
  quiet_start    time,
  quiet_end      time,
  time_zone      text not null default 'UTC',
  updated_at     timestamptz not null default now(),
  constraint alert_preferences_home_source check (home_source in ('device', 'manual')),
  constraint alert_preferences_radius_range check (radius_m between 500 and 50000),
  constraint alert_preferences_wider_radius_range check (wider_radius_m between 0 and 50000),
  constraint alert_preferences_quiet_pair check ((quiet_start is null) = (quiet_end is null))
);

comment on table public.alert_preferences is
  'Who gets urgent alerts, where and when. Read by the owner; written only through set_alert_preferences() and upsert_push_token().';
comment on column public.alert_preferences.home_location is
  'Centre of the alert area, rounded to ~110 m. Follows the device (upsert_push_token) while home_source = device; pinned once the user sets it.';
comment on column public.alert_preferences.wider_radius_m is
  'Farthest distance for an escalated urgent alert (nobody nearer has responded). At or below radius_m means no escalated alerts.';
comment on column public.alert_preferences.on_duty is
  'Off duty: no urgent alerts at all, in the inbox or by push. Updates about the user''s own cases still arrive.';

create index if not exists alert_preferences_home_idx
  on public.alert_preferences using gist (home_location)
  where on_duty and urgent_alerts and home_location is not null;

alter table public.alert_preferences enable row level security;
drop policy if exists "users read their own alert preferences" on public.alert_preferences;
create policy "users read their own alert preferences"
  on public.alert_preferences for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.alert_preferences from anon;
revoke insert, update, delete, truncate on public.alert_preferences from authenticated;
grant select on public.alert_preferences to authenticated;

-- Everyone who registered a device keeps the alerts they have today: their
-- latest device's area, radius and opt-in become their preferences.
insert into public.alert_preferences (user_id, home_location, radius_m, wider_radius_m, urgent_alerts)
select distinct on (t.user_id)
       t.user_id,
       t.last_known_location,
       greatest(500, least(t.notify_radius_m, 50000)),
       greatest(0, least(t.escalation_radius_m, 50000)),
       t.urgent_opt_in
from public.device_push_tokens t
order by t.user_id, t.updated_at desc
on conflict (user_id) do nothing;

-- Is p_now inside a quiet window? A window may cross midnight (22:00–07:00).
-- An equal start and end is an empty window, not the whole day.
create or replace function private.in_quiet_hours(
  p_start time, p_end time, p_time_zone text, p_now timestamptz
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local time;
begin
  if p_start is null or p_end is null or p_start = p_end then return false; end if;
  begin
    v_local := (p_now at time zone p_time_zone)::time;
  exception when others then
    v_local := (p_now at time zone 'UTC')::time;
  end;
  if p_start < p_end then
    return v_local >= p_start and v_local < p_end;
  end if;
  return v_local >= p_start or v_local < p_end;
end;
$$;
revoke execute on function private.in_quiet_hours(time, time, text, timestamptz) from public, anon, authenticated;

create or replace function public.set_alert_preferences(
  p_on_duty        boolean,
  p_urgent_alerts  boolean,
  p_radius_m       integer,
  p_wider_radius_m integer,
  p_time_zone      text,
  p_quiet_start    time default null,
  p_quiet_end      time default null,
  p_home_lat       double precision default null,
  p_home_lng       double precision default null
)
returns public.alert_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  v_tz text := coalesce(nullif(btrim(p_time_zone), ''), 'UTC');
  geo  public.geography;
  r    public.alert_preferences;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if p_radius_m is null or p_radius_m not between 500 and 50000 then
    raise exception 'Alert radius must be between 0.5 and 50 km';
  end if;
  if p_wider_radius_m is null or p_wider_radius_m not between 0 and 50000 then
    raise exception 'Wider alert radius must be between 0 and 50 km';
  end if;
  if (p_quiet_start is null) <> (p_quiet_end is null) then
    raise exception 'Quiet hours need both a start and an end';
  end if;
  -- The zone only places quiet hours. A phone reporting a zone the server
  -- does not know must not block every other setting, so it is refused only
  -- when quiet hours depend on it.
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_tz) then
    if p_quiet_start is not null then
      raise exception 'Unknown time zone';
    end if;
    v_tz := 'UTC';
  end if;
  if (p_home_lat is null) <> (p_home_lng is null)
     or (p_home_lat is not null
         and not (p_home_lat between -90 and 90 and p_home_lng between -180 and 180)) then
    raise exception 'Invalid coordinates';
  end if;
  if p_home_lat is not null then
    geo := public.st_setsrid(
             public.st_makepoint(round(p_home_lng::numeric, 3)::float8,
                                 round(p_home_lat::numeric, 3)::float8), 4326)::public.geography;
  end if;

  insert into public.alert_preferences as ap (
    user_id, on_duty, urgent_alerts, radius_m, wider_radius_m,
    quiet_start, quiet_end, time_zone, home_location, home_source, updated_at)
  values (
    uid, coalesce(p_on_duty, true), coalesce(p_urgent_alerts, true), p_radius_m, p_wider_radius_m,
    p_quiet_start, p_quiet_end, v_tz, geo,
    case when geo is null then 'device' else 'manual' end, now())
  on conflict (user_id) do update set
    on_duty        = excluded.on_duty,
    urgent_alerts  = excluded.urgent_alerts,
    radius_m       = excluded.radius_m,
    wider_radius_m = excluded.wider_radius_m,
    quiet_start    = excluded.quiet_start,
    quiet_end      = excluded.quiet_end,
    time_zone      = excluded.time_zone,
    home_location  = coalesce(geo, ap.home_location),
    home_source    = case when geo is null then ap.home_source else 'manual' end,
    updated_at     = now()
  returning * into r;
  return r;
end;
$$;
revoke execute on function public.set_alert_preferences(boolean, boolean, integer, integer, text, time, time, double precision, double precision) from public, anon;
grant  execute on function public.set_alert_preferences(boolean, boolean, integer, integer, text, time, time, double precision, double precision) to authenticated;

-- 0034's body, plus: the device's area becomes the alert area unless the
-- user pinned one.
create or replace function public.upsert_push_token(
  p_token text, p_lat double precision default null, p_lng double precision default null
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := auth.uid(); geo geography(Point, 4326);
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'
    or length(p_token) > 256 then raise exception 'Invalid push token'; end if;
  if (p_lat is null) <> (p_lng is null) or
    (p_lat is not null and not (p_lat between -90 and 90 and p_lng between -180 and 180))
    then raise exception 'Invalid coordinates'; end if;
  if p_lat is not null then
    geo := st_setsrid(st_makepoint(round(p_lng::numeric,3)::float8, round(p_lat::numeric,3)::float8),4326)::geography;
  end if;
  insert into public.device_push_tokens(user_id,token,last_known_location,push_enabled,urgent_opt_in,updated_at)
  values(uid,p_token,geo,true,true,now())
  on conflict(token) do update set user_id=excluded.user_id,
    last_known_location=excluded.last_known_location, push_enabled=true, urgent_opt_in=true,
    notify_radius_m=8000, updated_at=now();
  delete from public.device_push_tokens where user_id=uid and token not in (
    select token from public.device_push_tokens where user_id=uid order by updated_at desc, token limit 10
  );

  insert into public.alert_preferences as ap (user_id, home_location)
  values (uid, geo)
  on conflict (user_id) do update
    set home_location = excluded.home_location, updated_at = now()
    where ap.home_source = 'device' and excluded.home_location is not null;
end $$;
revoke execute on function public.upsert_push_token(text,float8,float8) from public,anon;
grant execute on function public.upsert_push_token(text,float8,float8) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The inbox (R1.5)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  sighting_id uuid references public.sightings (id) on delete cascade,
  detail      jsonb not null default '{}'::jsonb,
  batch_id    uuid,
  silent      boolean not null default false,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  constraint notifications_kind check (kind in (
    'urgent_sighting', 'sighting_claimed', 'rescue_completed', 'adoption_interest',
    'case_status', 'screening_decided', 'adoption_approved', 'adoption_declined',
    'new_comment', 'ops_job_failed', 'claim_expiring', 'claim_expired',
    'claim_reopened', 'urgent_unclaimed', 'urgent_no_responder'))
);

comment on table public.notifications is
  'The inbox: one row for every alert or update sent to a user, written in the same transaction as the event (private.post_push). Read by the owner; read state changes only through mark_notifications_read().';
comment on column public.notifications.detail is
  'What the entry needs to be worded later: the escalation step of an urgent alert, the new status of a case, the screening decision.';
comment on column public.notifications.batch_id is
  'Urgent broadcasts only: every row of one broadcast shares it, and send-push delivers by it.';
comment on column public.notifications.silent is
  'Recorded without a push, because it arrived in the recipient''s quiet hours.';

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;
create index if not exists notifications_batch_idx
  on public.notifications (batch_id) where batch_id is not null;
create index if not exists notifications_sighting_idx
  on public.notifications (sighting_id) where sighting_id is not null;

alter table public.notifications enable row level security;
drop policy if exists "users read their own notifications" on public.notifications;
create policy "users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update, delete, truncate on public.notifications from authenticated;
grant select on public.notifications to authenticated;

-- Mark some (or, with null, all) of the caller's entries read. Returns how
-- many changed.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  v_count integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_ids is not null and cardinality(p_ids) > 500 then
    raise exception 'Too many notifications at once';
  end if;
  update public.notifications n
  set read_at = now()
  where n.user_id = uid
    and n.read_at is null
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant  execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audience for an urgent broadcast, per person.
--    Step 1: within the base radius (or the person's own, if smaller).
--    Step 2: beyond that, as far as the person's wider radius allows.
--    Never the reporter, nobody off duty or opted out, nobody who blocked the
--    reporter. `quiet` = inside their quiet hours: inbox only, no push.
-- ---------------------------------------------------------------------------
create or replace function private.alert_audience(
  p_location public.geography,
  p_reporter uuid,
  p_step     integer,
  p_now      timestamptz default now()
)
returns table (user_id uuid, quiet boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id,
         private.in_quiet_hours(p.quiet_start, p.quiet_end, p.time_zone, p_now)
  from public.alert_preferences p
  where p.on_duty
    and p.urgent_alerts
    and p.home_location is not null
    -- Constant-distance prefilter, so the gist index can be used; the
    -- per-person distances below then narrow it.
    and public.st_dwithin(p.home_location, p_location, 20000)
    and p.user_id is distinct from p_reporter
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = p.user_id and b.blocked_id = p_reporter)
    and case
      when p_step = 1 then
        public.st_dwithin(p.home_location, p_location, least(8000, p.radius_m))
      when p_step = 2 then
        public.st_dwithin(p.home_location, p_location, least(20000, p.wider_radius_m))
        and not public.st_dwithin(p.home_location, p_location, least(8000, p.radius_m))
      else false
    end;
$$;
revoke execute on function private.alert_audience(public.geography, uuid, integer, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The one notification path
-- ---------------------------------------------------------------------------

-- Transport only: queue an HTTP call to send-push. 0042's private.post_push
-- body, renamed; post_push itself now records before it sends.
create or replace function private.http_push(p_body jsonb)
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
    raise warning 'http_push: private.push_config not configured — skipping %', p_body;
    return;
  end if;

  begin
    perform net.http_post(
      url     => v_url,
      headers => jsonb_build_object(
        'Content-Type',          'application/json',
        'x-push-webhook-secret', v_secret
      ),
      body    => p_body,
      timeout_milliseconds => 5000
    );
  exception when others then
    raise warning 'http_push: failed to enqueue %: %', p_body, sqlerrm;
  end;
end;
$$;
revoke execute on function private.http_push(jsonb) from public, anon, authenticated;

-- An urgent broadcast: one inbox row per person in the audience, then one call
-- for send-push to deliver the batch. Nothing for a report that is no longer
-- open, urgent or visible.
create or replace function private.broadcast_urgent(p_sighting uuid, p_step integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s       public.sightings;
  v_batch uuid := gen_random_uuid();
  v_count integer;
begin
  select * into s from public.sightings where id = p_sighting;
  if not found or not s.needs_urgent_help or s.status <> 'spotted' or s.is_hidden then
    return 0;
  end if;

  insert into public.notifications (user_id, kind, sighting_id, detail, batch_id, silent)
  select a.user_id, 'urgent_sighting', p_sighting,
         jsonb_build_object('step', p_step), v_batch, a.quiet
  from private.alert_audience(s.location, s.reporter_id, p_step) a;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform private.http_push(jsonb_build_object(
      'type', 'urgent_sighting', 'sighting_id', p_sighting,
      'escalation_step', p_step, 'batch_id', v_batch));
  end if;
  return v_count;
end;
$$;
revoke execute on function private.broadcast_urgent(uuid, integer) from public, anon, authenticated;

-- What send-push delivers for a broadcast: the devices of everyone in the
-- batch who is not in quiet hours and has push on. Service role only.
create or replace function public.batch_push_tokens(p_batch uuid)
returns table (token text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.token
  from public.notifications n
  join public.device_push_tokens t on t.user_id = n.user_id
  where n.batch_id = p_batch
    and not n.silent
    and t.push_enabled
    and t.urgent_opt_in;
$$;
revoke execute on function public.batch_push_tokens(uuid) from public, anon, authenticated;
grant  execute on function public.batch_push_tokens(uuid) to service_role;

-- Record, then send. The body is the send-push contract:
--   { type: 'urgent_sighting', sighting_id, escalation_step }  → broadcast
--   { type, sighting_id, recipient_user_id }                   → 0029 lifecycle
--   { event, recipient_user_id, about_sighting_id?, ...detail } → 0038/0042/0043 events
-- Anything else in the body is kept as the entry's detail. Never raises: an
-- inbox or queue failure is a warning, so it can never undo the user's write.
-- A failure to record never costs the push: the push still goes, and a
-- broadcast that cannot be recorded falls back to send-push's own audience
-- lookup (no batch_id).
create or replace function private.post_push(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind      text := coalesce(p_body->>'event', p_body->>'type');
  v_recipient uuid;
  v_sighting  uuid;
begin
  if p_body->>'type' = 'urgent_sighting' and p_body->>'recipient_user_id' is null then
    begin
      perform private.broadcast_urgent(
        (p_body->>'sighting_id')::uuid,
        coalesce((p_body->>'escalation_step')::integer, 1));
    exception when others then
      raise warning 'post_push: could not record broadcast %: %', p_body, sqlerrm;
      perform private.http_push(p_body);
    end;
    return;
  end if;

  begin
    v_recipient := (p_body->>'recipient_user_id')::uuid;
    v_sighting  := coalesce(p_body->>'about_sighting_id', p_body->>'sighting_id')::uuid;
    if v_recipient is null or v_kind is null then
      raise warning 'post_push: no recipient or kind in %', p_body;
      return;
    end if;

    insert into public.notifications (user_id, kind, sighting_id, detail)
    values (v_recipient, v_kind, v_sighting,
            p_body - array['event', 'type', 'recipient_user_id', 'about_sighting_id', 'sighting_id']);
  exception when others then
    raise warning 'post_push: could not record %: %', p_body, sqlerrm;
  end;

  perform private.http_push(p_body);
end;
$$;
revoke execute on function private.post_push(jsonb) from public, anon, authenticated;

-- The older funnels keep their signatures (the 0029/0038 triggers call them)
-- and now go through the one path.
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
begin
  perform private.post_push(jsonb_build_object(
    'type', p_type, 'sighting_id', p_sighting_id, 'recipient_user_id', p_recipient_user_id));
end;
$$;
revoke execute on function public.enqueue_push_notification(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.enqueue_push_event(
  p_event     text,
  p_recipient uuid,
  p_sighting  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then return; end if;
  perform private.post_push(jsonb_build_object(
    'event', p_event, 'recipient_user_id', p_recipient, 'about_sighting_id', p_sighting));
end;
$$;
revoke execute on function public.enqueue_push_event(text, uuid, uuid) from public, anon, authenticated;

-- 0038's screening trigger, now keeping the decision on the entry so the
-- inbox can say what it was even after the screening changes again.
create or replace function public.on_screening_decision_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from auth.uid()
     and new.status in ('approved', 'rejected', 'needs_review') then
    perform private.post_push(jsonb_build_object(
      'event', 'screening_decided', 'recipient_user_id', new.user_id, 'status', new.status));
  end if;
  return new;
end;
$$;
revoke execute on function public.on_screening_decision_push() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The reporter hears about every state change (R1.9)
--
-- claimed and safe keep their 0029 events. Every other new status is a
-- case_status event carrying the status. A return to spotted made by the
-- lease job (no auth.uid()) is left to the job, which sends claim_reopened;
-- one made by a person (a release) is told here. Nobody is told about their
-- own action.
-- ---------------------------------------------------------------------------
create or replace function public.on_sighting_status_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if new.reporter_id is null or new.reporter_id is not distinct from uid then
    return new;
  end if;

  if new.status = 'claimed' then
    perform public.enqueue_push_notification('sighting_claimed', new.id, new.reporter_id);
  elsif new.status = 'safe' then
    perform public.enqueue_push_notification('rescue_completed', new.id, new.reporter_id);
  elsif new.status = 'spotted' and uid is null then
    null;
  else
    perform private.post_push(jsonb_build_object(
      'event', 'case_status', 'recipient_user_id', new.reporter_id,
      'about_sighting_id', new.id, 'status', new.status::text));
  end if;
  return new;
end;
$$;
revoke execute on function public.on_sighting_status_push() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Retention: entries older than 90 days go. run_job is 0042's body plus
--    the new job.
-- ---------------------------------------------------------------------------
create or replace function private.prune_notifications(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.notifications where created_at < p_now - interval '90 days';
  get diagnostics v_count = row_count;
  return jsonb_build_object('pruned', v_count);
end;
$$;
revoke execute on function private.prune_notifications(timestamptz) from public, anon, authenticated;

create or replace function private.run_job(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        bigint;
  v_result    jsonb;
  v_was_ok    boolean;
  v_moderator uuid;
begin
  select j.ok into v_was_ok
  from private.job_runs j
  where j.job = p_job and j.finished_at is not null
  order by j.started_at desc, j.id desc
  limit 1;

  insert into private.job_runs (job) values (p_job) returning id into v_id;
  begin
    case p_job
      when 'claim_leases' then
        v_result := private.warn_expiring_claims() || private.expire_stale_claims();
      when 'urgent_escalation' then
        v_result := private.escalate_unclaimed_urgent();
      when 'prune_job_runs' then
        delete from private.job_runs where started_at < now() - interval '14 days';
        v_result := '{}'::jsonb;
      when 'prune_notifications' then
        v_result := private.prune_notifications();
      else
        raise exception 'Unknown job %', p_job;
    end case;
    update private.job_runs
    set finished_at = clock_timestamp(), ok = true, result = v_result
    where id = v_id;
  exception when others then
    update private.job_runs
    set finished_at = clock_timestamp(), ok = false, error = sqlerrm
    where id = v_id;
    if v_was_ok is distinct from false then
      for v_moderator in select p.id from public.profiles p where p.is_moderator loop
        perform private.post_push(jsonb_build_object(
          'event', 'ops_job_failed', 'recipient_user_id', v_moderator));
      end loop;
    end if;
  end;
  return v_result;
end;
$$;
revoke execute on function private.run_job(text) from public, anon, authenticated;

select cron.schedule('guardians-prune-notifications', '41 3 * * *',
  $cron$select private.run_job('prune_notifications')$cron$);
