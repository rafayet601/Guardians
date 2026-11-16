-- 0042 — Scheduled jobs, claim leases and urgent escalation.
--
-- PRD-2.0 R1.7 (one mechanism for timed work), R1.1 (a claim is a lease the
-- server enforces) and R1.2 (an unclaimed urgent report escalates instead of
-- waiting). Owner decisions D1 and D5 set the numbers:
--   * a claim lapses after 24 h without a Guardian update, 72 h once the cat
--     is in rescue; the Guardian is warned 6 h before and can extend;
--   * an unclaimed urgent report reaches a wider ring at 20 min and the
--     operators and the reporter at 60 min.
--
-- Nothing here pushes by itself on apply: existing claims get a full fresh
-- lease, and only reports opened in the last 24 h are ever escalated.
-- Apply only after staging rehearsal; deploy send-push first so the new
-- events and the ring broadcast are understood.

-- ---------------------------------------------------------------------------
-- 1. Scheduled-jobs foundation (R1.7)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

create table if not exists private.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  result      jsonb,
  error       text
);
create index if not exists job_runs_job_started_idx on private.job_runs (job, started_at desc);
alter table private.job_runs enable row level security;

comment on table private.job_runs is
  'One row per scheduled-job run (private.run_job). ok = false rows are failures; get_job_health() summarises them for moderators.';

-- The single funnel to send-push for everything in this migration. Same
-- contract as enqueue_push_notification / enqueue_push_event: reads
-- private.push_config, posts asynchronously, never raises.
create or replace function private.post_push(p_body jsonb)
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
    raise warning 'post_push: private.push_config not configured — skipping %', p_body;
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
    raise warning 'post_push: failed to enqueue %: %', p_body, sqlerrm;
  end;
end;
$$;
revoke execute on function private.post_push(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Lease and escalation state
-- ---------------------------------------------------------------------------
alter table public.sightings
  add column if not exists claim_expires_at   timestamptz,
  add column if not exists claim_warned_at    timestamptz,
  add column if not exists urgent_since       timestamptz,
  add column if not exists escalation_step    smallint not null default 1,
  add column if not exists urgent_rebroadcasts smallint not null default 0;

do $$ begin
  alter table public.sightings
    add constraint sightings_escalation_step_range check (escalation_step between 0 and 3);
exception when duplicate_object then null; end $$;

comment on column public.sightings.claim_expires_at is
  'When the current claim lapses unless the Guardian acts. Null when nobody holds a lease. Maintained by maintain_claim_lease(); never client-writable.';
comment on column public.sightings.urgent_since is
  'Start of the current unclaimed period when that is not the report''s creation: set when a claim is released or lapses, or an open report is newly marked urgent. The escalation ladder is timed from coalesce(urgent_since, created_at).';
comment on column public.sightings.escalation_step is
  '0 = base alert owed (reopened or newly urgent), 1 = base alert sent, 2 = wider ring alerted, 3 = operators and reporter told.';

-- Lease lengths (owner decision D1).
create or replace function public.claim_lease(p_status public.cat_status)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'claimed'   then interval '24 hours'
    when 'in_rescue' then interval '72 hours'
  end;
$$;

-- How long before the lapse the Guardian is warned and may extend.
create or replace function public.claim_warning_lead()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '6 hours'; $$;

revoke execute on function public.claim_lease(public.cat_status) from public, anon, authenticated;
revoke execute on function public.claim_warning_lead()            from public, anon, authenticated;

-- updated_at is what the app shows as "last recorded activity". A lease
-- warning, a ladder step or a backfill is bookkeeping, not activity, so those
-- columns alone never move it.
create or replace function public.set_sighting_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- lat and lng are generated from location, which is compared; in a BEFORE
  -- trigger NEW does not carry generated values yet, so they are left out.
  v_ignored constant text[] := array[
    'updated_at', 'claim_expires_at', 'claim_warned_at',
    'urgent_since', 'escalation_step', 'urgent_rebroadcasts', 'lat', 'lng'];
begin
  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.set_sighting_updated_at() from public, anon, authenticated;

drop trigger if exists sightings_set_updated_at on public.sightings;
create trigger sightings_set_updated_at
  before update on public.sightings
  for each row execute function public.set_sighting_updated_at();

-- Existing claims start a full lease now, so nobody is expired by the apply.
update public.sightings
set claim_expires_at = now() + public.claim_lease(status)
where claimed_by is not null and status in ('claimed', 'in_rescue') and claim_expires_at is null;

create index if not exists sightings_claim_expiry_idx
  on public.sightings (claim_expires_at)
  where claim_expires_at is not null;
create index if not exists sightings_urgent_open_idx
  on public.sightings (created_at)
  where needs_urgent_help and status = 'spotted' and escalation_step < 3;

grant select (claim_expires_at, escalation_step) on public.sightings to authenticated;

-- How far an escalated alert may reach this device. Its own preference, so a
-- wider ring never overrides the radius chosen for ordinary alerts.
alter table public.device_push_tokens
  add column if not exists escalation_radius_m integer not null default 20000;
do $$ begin
  alter table public.device_push_tokens
    add constraint device_push_tokens_escalation_radius_range
    check (escalation_radius_m between 0 and 50000);
exception when duplicate_object then null; end $$;
comment on column public.device_push_tokens.escalation_radius_m is
  'Farthest distance for an escalated urgent alert (nobody nearer has responded). Set it to notify_radius_m or less to receive no escalated alerts.';

-- One place keeps the lease and the ladder consistent, whichever RPC changed
-- the row: claim, status change, adoption approval or moderation.
create or replace function public.maintain_claim_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.claimed_by is null or new.status not in ('claimed', 'in_rescue') then
    new.claim_expires_at := null;
    new.claim_warned_at  := null;
  elsif tg_op = 'INSERT' then
    new.claim_expires_at := now() + public.claim_lease(new.status);
    new.claim_warned_at  := null;
  elsif new.status is distinct from old.status
     or new.claimed_by is distinct from old.claimed_by then
    new.claim_expires_at := now() + public.claim_lease(new.status);
    new.claim_warned_at  := null;
  end if;

  if tg_op = 'UPDATE' then
    -- Back on the map, or newly marked urgent while open: the base alert is
    -- owed again and the ladder restarts.
    if new.status = 'spotted'
       and (old.status <> 'spotted'
            or (new.needs_urgent_help and not old.needs_urgent_help)) then
      new.urgent_since    := now();
      new.escalation_step := 0;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.maintain_claim_lease() from public, anon, authenticated;

drop trigger if exists sightings_claim_lease on public.sightings;
create trigger sightings_claim_lease
  before insert or update on public.sightings
  for each row execute function public.maintain_claim_lease();

-- A comment or photo from the assigned Guardian is an update: it renews the
-- lease. The row lock makes this lose cleanly to an expiry already under way.
create or replace function public.renew_claim_on_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if tg_table_name = 'sighting_updates' then
    if new.type <> 'comment' then return new; end if;
    v_actor := new.author_id;
  else
    v_actor := new.uploaded_by;
  end if;
  if v_actor is null then return new; end if;

  update public.sightings s
  set claim_expires_at = now() + public.claim_lease(s.status),
      claim_warned_at  = null
  where s.id = new.sighting_id
    and s.claimed_by = v_actor
    and s.status in ('claimed', 'in_rescue');
  return new;
end;
$$;
revoke execute on function public.renew_claim_on_activity() from public, anon, authenticated;

drop trigger if exists sighting_updates_renew_claim on public.sighting_updates;
create trigger sighting_updates_renew_claim
  after insert on public.sighting_updates
  for each row execute function public.renew_claim_on_activity();

drop trigger if exists sighting_photos_renew_claim on public.sighting_photos;
create trigger sighting_photos_renew_claim
  after insert on public.sighting_photos
  for each row execute function public.renew_claim_on_activity();

-- ---------------------------------------------------------------------------
-- 3. extend_claim — the Guardian's one-tap "still on it"
-- ---------------------------------------------------------------------------
create or replace function public.extend_claim(p_sighting uuid)
returns public.sightings
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s   public.sightings;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting for update;
  if not found
     or s.claimed_by is distinct from uid
     or s.status not in ('claimed', 'in_rescue') then
    -- Also the answer when the lease already lapsed: the cat is no longer theirs.
    raise exception 'You are not the assigned Guardian for this cat';
  end if;

  -- Outside the warning window there is nothing to extend, and repeated taps
  -- must not fill the timeline.
  if s.claim_expires_at - now() > public.claim_warning_lead() then
    return s;
  end if;

  update public.sightings
  set claim_expires_at = now() + public.claim_lease(status),
      claim_warned_at  = null
  where id = p_sighting
  returning * into s;

  insert into public.sighting_updates (sighting_id, author_id, type, body)
  values (p_sighting, uid, 'system', 'The Guardian confirmed they are still on this rescue.');
  return s;
end;
$$;
revoke execute on function public.extend_claim(uuid) from public, anon;
grant  execute on function public.extend_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Jobs. Each takes the clock as a parameter so tests can move time, locks
--    the rows it acts on, and is safe to run twice.
-- ---------------------------------------------------------------------------
create or replace function private.warn_expiring_claims(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_count integer := 0;
begin
  for r in
    select s.id, s.claimed_by
    from public.sightings s
    where s.status in ('claimed', 'in_rescue')
      and s.claimed_by is not null
      and s.claim_warned_at is null
      and s.claim_expires_at > p_now
      and s.claim_expires_at - public.claim_warning_lead() <= p_now
    order by s.claim_expires_at
    for update skip locked
  loop
    update public.sightings set claim_warned_at = p_now where id = r.id;
    perform private.post_push(jsonb_build_object(
      'event', 'claim_expiring', 'recipient_user_id', r.claimed_by, 'about_sighting_id', r.id));
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('warned', v_count);
end;
$$;

create or replace function private.expire_stale_claims(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_count integer := 0;
begin
  for r in
    select s.id, s.status, s.claimed_by, s.reporter_id
    from public.sightings s
    where s.status in ('claimed', 'in_rescue')
      and s.claim_expires_at is not null
      and s.claim_expires_at <= p_now
    order by s.claim_expires_at
    for update skip locked
  loop
    -- A lapse returns the cat to the pool from either state; the user-facing
    -- transition table does not apply to this system action.
    update public.sightings
    set status = 'spotted', claimed_by = null, claimed_at = null
    where id = r.id;

    insert into public.sighting_updates (sighting_id, author_id, type, old_status, new_status, body)
    values (r.id, null, 'system', r.status, 'spotted',
            'The Guardian did not post an update in time, so this cat is back on the map for another Guardian.');

    perform private.post_push(jsonb_build_object(
      'event', 'claim_expired', 'recipient_user_id', r.claimed_by, 'about_sighting_id', r.id));
    if r.reporter_id is not null and r.reporter_id is distinct from r.claimed_by then
      perform private.post_push(jsonb_build_object(
        'event', 'claim_reopened', 'recipient_user_id', r.reporter_id, 'about_sighting_id', r.id));
    end if;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('expired', v_count);
end;
$$;

-- The ladder (owner decision D5). One step per report per run, so a job that
-- was down never sends two alerts for one report at once.
create or replace function private.escalate_unclaimed_urgent(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r           record;
  v_moderator uuid;
  v_base      integer := 0;
  v_ring      integer := 0;
  v_operators integer := 0;
begin
  for r in
    select s.id, s.reporter_id, s.escalation_step, s.urgent_rebroadcasts
    from public.sightings s
    where s.status = 'spotted'
      and s.needs_urgent_help
      and not s.is_hidden
      and s.escalation_step < 3
      -- Reports open for more than a day are no longer escalated.
      and coalesce(s.urgent_since, s.created_at) > p_now - interval '24 hours'
      and (
        s.escalation_step = 0
        or (s.escalation_step = 1
            and coalesce(s.urgent_since, s.created_at) <= p_now - interval '20 minutes')
        or (s.escalation_step = 2
            and coalesce(s.urgent_since, s.created_at) <= p_now - interval '60 minutes')
      )
    order by coalesce(s.urgent_since, s.created_at)
    for update skip locked
  loop
    if r.escalation_step = 0 then
      -- Reopened or newly urgent. Two repeats at most per report, so claiming
      -- and releasing cannot be used to broadcast without limit.
      if r.urgent_rebroadcasts < 2 then
        update public.sightings
        set escalation_step = 1, urgent_rebroadcasts = urgent_rebroadcasts + 1
        where id = r.id;
        perform private.post_push(jsonb_build_object(
          'type', 'urgent_sighting', 'sighting_id', r.id, 'escalation_step', 1));
        v_base := v_base + 1;
      else
        update public.sightings set escalation_step = 2 where id = r.id;
      end if;

    elsif r.escalation_step = 1 then
      update public.sightings set escalation_step = 2 where id = r.id;
      perform private.post_push(jsonb_build_object(
        'type', 'urgent_sighting', 'sighting_id', r.id, 'escalation_step', 2));
      v_ring := v_ring + 1;

    else
      update public.sightings set escalation_step = 3 where id = r.id;
      insert into public.sighting_updates (sighting_id, author_id, type, body)
      values (r.id, null, 'system',
              'No Guardian has been able to respond yet. The alert has gone to a wider area and the Guardians team has been told. If the cat is in immediate danger, contact a local emergency vet or animal control.');
      for v_moderator in select p.id from public.profiles p where p.is_moderator loop
        if v_moderator is distinct from r.reporter_id then
          perform private.post_push(jsonb_build_object(
            'event', 'urgent_unclaimed', 'recipient_user_id', v_moderator, 'about_sighting_id', r.id));
        end if;
      end loop;
      if r.reporter_id is not null then
        perform private.post_push(jsonb_build_object(
          'event', 'urgent_no_responder', 'recipient_user_id', r.reporter_id, 'about_sighting_id', r.id));
      end if;
      v_operators := v_operators + 1;
    end if;
  end loop;
  return jsonb_build_object('base', v_base, 'ring', v_ring, 'operators', v_operators);
end;
$$;

-- Every scheduled job goes through here: one log row per run, the job's own
-- writes rolled back if it throws, and the operators told when a job that was
-- healthy starts failing.
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

revoke execute on function private.warn_expiring_claims(timestamptz)      from public, anon, authenticated;
revoke execute on function private.expire_stale_claims(timestamptz)       from public, anon, authenticated;
revoke execute on function private.escalate_unclaimed_urgent(timestamptz) from public, anon, authenticated;
revoke execute on function private.run_job(text)                          from public, anon, authenticated;

-- Moderators: is the timed work running?
create or replace function public.get_job_health()
returns table (job text, last_run timestamptz, last_ok boolean, failures_24h bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then raise exception 'Moderators only'; end if;
  return query
    select j.job,
           max(j.started_at),
           (array_agg(j.ok order by j.started_at desc, j.id desc))[1],
           count(*) filter (where j.ok is false and j.started_at > now() - interval '24 hours')
    from private.job_runs j
    group by j.job
    order by j.job;
end;
$$;
revoke execute on function public.get_job_health() from public, anon;
grant  execute on function public.get_job_health() to authenticated;

-- cron.schedule replaces a job of the same name, so re-applying is safe.
select cron.schedule('guardians-claim-leases',      '*/5 * * * *', $cron$select private.run_job('claim_leases')$cron$);
select cron.schedule('guardians-urgent-escalation', '* * * * *',   $cron$select private.run_job('urgent_escalation')$cron$);
select cron.schedule('guardians-prune-job-runs',    '17 3 * * *',  $cron$select private.run_job('prune_job_runs')$cron$);

-- ---------------------------------------------------------------------------
-- 5. Audience for the wider ring: everyone the base alert did not reach, as
--    far as each device allows. Service-role only, like tokens_near.
-- ---------------------------------------------------------------------------
create or replace function public.tokens_in_ring(
  p_lat double precision,
  p_lng double precision,
  p_inner_m integer default 8000,
  p_outer_m integer default 20000,
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
      least(p_outer_m, t.escalation_radius_m)
    )
    and not st_dwithin(
      t.last_known_location,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      least(p_inner_m, t.notify_radius_m)
    );
$$;
revoke execute on function public.tokens_in_ring(double precision, double precision, integer, integer, uuid) from public, anon, authenticated;
grant  execute on function public.tokens_in_ring(double precision, double precision, integer, integer, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. get_sighting_detail — 0039's body plus the lease and ladder fields.
-- ---------------------------------------------------------------------------
create or replace function public.get_sighting_detail(p_sighting uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  s         public.sightings;
  v_precise boolean;
  v_lat     double precision;
  v_lng     double precision;
  result    jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into s from public.sightings where id = p_sighting;
  if not found then raise exception 'Sighting not found'; end if;

  v_precise :=
    uid = coalesce(s.reporter_id, '00000000-0000-0000-0000-000000000000')
    or uid = coalesce(s.claimed_by, '00000000-0000-0000-0000-000000000000');

  if not public.is_moderator() and exists (
    select 1 from public.user_blocks b
    where b.blocker_id = uid and b.blocked_id = s.reporter_id
  ) then
    raise exception 'Sighting not found';
  end if;

  -- Hidden cats are visible only to the people managing them and moderators.
  if s.is_hidden and not v_precise and not public.is_moderator() then
    raise exception 'Sighting not found';
  end if;

  if v_precise then
    v_lat := s.lat; v_lng := s.lng;
  else
    v_lat := round(s.lat::numeric, 3)::double precision;
    v_lng := round(s.lng::numeric, 3)::double precision;
  end if;

  result := jsonb_build_object(
    'id', s.id, 'reporter_id', s.reporter_id, 'title', s.title, 'description', s.description,
    'address', case when v_precise then s.address else null end,
    'status', s.status, 'temperament', s.temperament, 'color', s.color,
    'is_injured', s.is_injured, 'needs_urgent_help', s.needs_urgent_help,
    'claimed_by', s.claimed_by, 'claimed_at', s.claimed_at, 'rescued_at', s.rescued_at,
    'created_at', s.created_at, 'updated_at', s.updated_at,
    'claim_expires_at', s.claim_expires_at, 'escalation_step', s.escalation_step,
    'lat', v_lat, 'lng', v_lng, 'is_precise', v_precise,
    'reporter', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'level', p.level)
                 from public.profiles p where p.id = s.reporter_id),
    'claimer', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'level', p.level)
                from public.profiles p where p.id = s.claimed_by),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'sighting_id', ph.sighting_id, 'url', ph.url,
                                'uploaded_by', ph.uploaded_by, 'created_at', ph.created_at) order by ph.created_at)
               from public.sighting_photos ph where ph.sighting_id = s.id), '[]'::jsonb)
  );
  return result;
end;
$$;
revoke execute on function public.get_sighting_detail(uuid) from public;
grant  execute on function public.get_sighting_detail(uuid) to authenticated;
